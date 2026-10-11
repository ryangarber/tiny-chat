#!/usr/bin/env node

import { type ChildProcess, spawn } from "node:child_process";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { concurrently } from "concurrently";
import waitOn from "wait-on";
import { zClientEnv } from "../packages/core/src/core/types/env.ts";
import { useEnv } from "./use-env.ts";
import { create, print } from "./use-stdout.ts";

useEnv({ type: zClientEnv });

export const serverUrl = `http://${process.env.DEV_HOST}:${process.env.VITE_SERVER_PORT}`;

export async function isServerLive() {
	const update = create(`trying server at ${serverUrl}`);
	try {
		const result = await fetch(serverUrl, {
			signal: AbortSignal.timeout(5_000),
		});
		update(`server is ${result.ok ? "live" : "not live"}`);
		return result.ok;
	} catch {
		update("server is not live");
		return false;
	}
}

export async function isServerNeeded(start: boolean | null | undefined) {
	if (start !== false) {
		const isLive = await isServerLive();
		if (start === true || !isLive) {
			print({ message: "starting server..." });
			return true;
		}
	} else {
		print({ message: "waiting for a server..." });
	}
	return false;
}

// Processes that share one server port (parallel Vitest projects under turbo,
// `pnpm dev:cli`, ...) coordinate through this directory: `users/<pid>` marks a
// process using the server, `server` holds the pid of a server one of them
// spawned, and `lock/` serializes changes. Only one process spawns the server,
// and whichever user leaves last stops it, so nobody kills a server another
// process is still using.
const registryDir = join(
	tmpdir(),
	`tiny-chat-server-${process.env.VITE_SERVER_PORT}`,
);
const usersDir = join(registryDir, "users");
const serverFile = join(registryDir, "server");
const lockDir = join(registryDir, "lock");

function isAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function readPid(path: string) {
	try {
		const pid = Number.parseInt(readFileSync(path, "utf-8"), 10);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

async function withLock<T>(callback: () => Promise<T> | T): Promise<T> {
	mkdirSync(registryDir, { recursive: true });
	const pidFile = join(lockDir, "pid");
	for (;;) {
		try {
			mkdirSync(lockDir);
			writeFileSync(pidFile, `${process.pid}`);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			// Break locks left by a process that died while holding them.
			const holder = readPid(pidFile);
			const stale =
				holder !== undefined
					? !isAlive(holder)
					: Date.now() -
							(statSync(lockDir, { throwIfNoEntry: false })?.mtimeMs ?? 0) >
						5_000;
			if (stale) rmSync(lockDir, { recursive: true, force: true });
			else await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	try {
		return await callback();
	} finally {
		rmSync(lockDir, { recursive: true, force: true });
	}
}

function getOtherUsers() {
	mkdirSync(usersDir, { recursive: true });
	return readdirSync(usersDir)
		.map(Number)
		.filter((pid) => {
			if (pid === process.pid) return false;
			if (isAlive(pid)) return true;
			rmSync(join(usersDir, `${pid}`), { force: true });
			return false;
		});
}

function getServerPid() {
	const pid = readPid(serverFile);
	if (pid !== undefined && isAlive(pid)) return pid;
	rmSync(serverFile, { force: true });
	return undefined;
}

async function stopServer(pid: number) {
	try {
		process.kill(pid);
	} catch {
		return;
	}
	const deadline = Date.now() + 5_000;
	while (isAlive(pid)) {
		if (Date.now() > deadline) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

export async function useServer({
	execPath = process.execPath,
	start,
	quiet,
}: {
	execPath?: string;
	start?: boolean | null;
	/**
	 * Keeps the server's output off the terminal, for a host drawing its own UI
	 * there; the server still logs to disk. Only the end of its stderr is kept,
	 * to report a server that fails to start.
	 */
	quiet?: boolean;
} = {}) {
	print({ message: "starting..." });

	let child: ChildProcess | undefined;
	let stderr = "";
	let released = false;

	const release = () =>
		withLock(async () => {
			if (released) return;
			released = true;
			process.off("exit", onExit);
			rmSync(join(usersDir, `${process.pid}`), { force: true });
			const serverPid = getServerPid();
			if (getOtherUsers().length === 0) {
				if (serverPid !== undefined) {
					print({ message: "stopping server..." });
					await stopServer(serverPid);
				}
				rmSync(serverFile, { force: true });
			} else if (child && child.pid === serverPid) {
				// Hand the server to the remaining users; the last one stops it.
				print({ message: "leaving server running for other processes" });
				child.unref();
			}
		});
	const onExit = () => {
		// Best-effort synchronous cleanup when the process exits without release().
		rmSync(join(usersDir, `${process.pid}`), { force: true });
		if (child?.pid !== undefined && getOtherUsers().length === 0) {
			child.kill();
			rmSync(serverFile, { force: true });
		}
	};

	await withLock(async () => {
		mkdirSync(usersDir, { recursive: true });
		writeFileSync(join(usersDir, `${process.pid}`), "");
		process.once("exit", onExit);

		// Another process already spawned the server; just wait for it.
		if (getServerPid() !== undefined && start !== true) return;

		if (await isServerNeeded(start)) {
			// Own the actual server process, without pnpm wrappers or a file watcher.
			child = spawn(
				execPath,
				[resolve(import.meta.dirname, "../packages/server/src/server.ts")],
				{
					stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
					env: process.env,
				},
			);
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (chunk: string) => {
				stderr = (stderr + chunk).slice(-4096);
			});
			if (child.pid !== undefined) writeFileSync(serverFile, `${child.pid}`);
		}
	});

	try {
		await Promise.race([
			waitOn({ resources: [serverUrl], timeout: 30_000 }),
			...(child
				? [
						new Promise<void>((resolve, reject) => {
							child?.once("error", reject);
							child?.once("exit", (code, signal) => {
								if (released) return;
								const error = new Error(
									`Server exited with ${signal ?? code}${stderr ? `\n${stderr}` : ""}`,
								);
								// Typically EADDRINUSE: a server started elsewhere won the port.
								waitOn({ resources: [serverUrl], timeout: 5_000 }).then(
									() => {
										print({ message: "using a server started elsewhere" });
										resolve();
									},
									() => reject(error),
								);
							});
						}),
					]
				: []),
		]);
	} catch (error) {
		await release();
		throw error;
	}

	return release;
}

if (import.meta.main) {
	await new Command()
		.option("--start", "start a server if one is not already running")
		.option("--no-start", "wait for an already existing server")
		.argument("<then...>", "commands with an optional 'name:' prefix")
		.action(async (then, { start }) => {
			print({ message: "starting..." });

			const doStart = await isServerNeeded(start);

			if (then.length !== 0) {
				print({
					message: `running ${then.length} command${then.length !== 1 ? "s" : ""}...`,
				});
				try {
					await concurrently(
						[
							...(doStart
								? [
										{
											name: "server",
											command: "pnpm -w dev:server",
										},
									]
								: []),
							...then.map((then) => {
								const [, name, command] =
									/^(?:\[([^\]]+)])?\s*(.*)$/.exec(then) ?? [];
								return { name, command: `wait-on ${serverUrl} && ${command}` };
							}),
						],
						{
							killOthersOn: ["success", "failure"],
							killTimeout: 5_000,
							prefixColors: "auto",
						},
					).result;
				} catch (object) {
					if (object instanceof Error) throw object;
					// concurrently rejects with exit events when a command fails.
					process.exitCode = 1;
				}
			}
		})
		.parseAsync();
}
