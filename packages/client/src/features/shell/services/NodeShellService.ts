import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { HostShellPrimitives } from "#client/features/shell/services/HostShellService.ts";
import { FileSystemUtils } from "#client/features/shell/utils/FileSystemUtils.ts";
import { ToolOutputUtils } from "#core/features/tool/utils/ToolOutputUtils.ts";

/** `paths` joined into one absolute path, with `~` as the home directory. */
const absolute = (...paths: string[]) =>
	resolve(
		...paths.map((path) => path.replace(/(^~[^/]*|%HOMEPATH%)/, homedir())),
	);

/** Variables that describe the shell that printed them rather than the user. */
const SKIP = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

const MARKER = "__TINY_CHAT_ENV__";

/**
 * The environment of the user's own shell, read once from an interactive
 * login shell as a terminal would start one. An app launched from Finder or
 * the Dock (or relaunched by its updater) gets launchd's bare environment, in
 * which anything the user's profile puts on the path — nvm, pnpm, Homebrew,
 * bun — is "command not found". Empty where it cannot be read, so commands
 * keep what the process inherited.
 */
let loginEnv: Promise<Record<string, string>> | undefined;
const readLoginEnv = () =>
	(loginEnv ??= new Promise((done) => {
		const shell = process.env.SHELL;
		if (process.platform === "win32" || !shell) return done({});

		// A profile can print anything, so the listing is fenced off.
		const child = spawn(
			shell,
			[
				"-i",
				"-l",
				"-c",
				`printf '${MARKER}'; command env -0; printf '${MARKER}'`,
			],
			{ stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
		);
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", () => done({}));
		child.on("close", () => {
			const [, listing] = stdout.split(MARKER);
			const env = Object.fromEntries(
				(listing ?? "")
					.split("\0")
					.map((entry) => {
						const index = entry.indexOf("=");
						return [entry.slice(0, index), entry.slice(index + 1)] as const;
					})
					.filter(([key]) => key && !SKIP.has(key)),
			);
			done(env.PATH ? env : {});
		});
	}));

export const NodeShellService = {
	/**
	 * `env` over the user's login shell environment when `login` is set (see
	 * `readLoginEnv`), or over this process's own otherwise.
	 */
	env: async ({
		env,
		login,
	}: {
		env?: Record<string, string>;
		login?: boolean;
	}): Promise<Record<string, string>> => ({
		...(process.env as Record<string, string>),
		...(login ? await readLoginEnv() : {}),
		...env,
	}),

	/**
	 * A `ClientShell`'s primitives over Node's file system and processes, for runtimes with
	 * Node's APIs (the CLI under Bun, the desktop app's main process).
	 *
	 * @param login Runs commands in the user's login shell environment rather
	 * 	than the one this process was started with; for an app that may have
	 * 	been launched outside a terminal.
	 */
	create: ({
		login = false,
	}: {
		login?: boolean;
	} = {}): HostShellPrimitives => {
		// Read ahead, since a login shell can take a moment to start.
		if (login) void readLoginEnv();

		return {
			os:
				process.platform === "win32"
					? "windows"
					: process.platform === "darwin"
						? "macos"
						: "linux",
			cwd: async () => {
				return process.cwd();
			},
			resolveDir: async ({ path }) => {
				path = await realpath(absolute(path));
				if (!(await stat(path)).isDirectory()) {
					throw new Error(`Not a directory: ${path}`);
				}
				return path;
			},
			locate: async ({ paths }) => {
				for (const candidate of paths) {
					const path = absolute(candidate);
					if (
						await stat(path).then(
							(stats) => stats.isFile(),
							() => false,
						)
					)
						return path;
				}
				return null;
			},
			readFile: async ({ path }) => {
				path = absolute(path);
				return {
					path,
					data: await readFile(path),
				};
			},
			writeFile: async ({ path, content }) => {
				path = absolute(path);
				mkdirSync(dirname(path), { recursive: true });
				await writeFile(path, content);
				return {
					path,
					success: true,
				};
			},
			readFiles: async ({ paths, maxBytes }) =>
				await FileSystemUtils.readFiles({
					paths: paths.map((path) => absolute(path)),
					maxBytes,
				}),
			readDir: async ({ path }) => {
				path = absolute(path);
				const entries = await readdir(path, { withFileTypes: true });
				return entries.map((entry) => ({
					path: absolute(path, entry.name),
					is_dir: entry.isDirectory(),
				}));
			},
			walk: async ({ path, ...options }) =>
				await FileSystemUtils.walk({ path: absolute(path), ...options }),
			// Spawned rather than buffered so output can be reported as it arrives;
			// the accumulated text is still what the tool result is built from. Its
			// own process group, so an interrupt reaches everything the shell
			// started rather than only the shell.
			spawn: async ({ program, args, cwd, env, stream, abort }) => {
				const environment = await NodeShellService.env({ env, login });
				return new Promise((resolve) => {
					const child = spawn(program, args, {
						cwd,
						env: environment,
						detached: process.platform !== "win32",
						windowsHide: true,
					});

					const stdout = ToolOutputUtils.collect();
					const stderr = ToolOutputUtils.collect();

					let settled = false;
					const settle = (code: number) => {
						if (settled) return;
						settled = true;
						abort?.removeEventListener("abort", kill);
						resolve({ code, stdout: stdout.text(), stderr: stderr.text() });
					};

					const signal = (name: NodeJS.Signals) => {
						if (child.pid === undefined) return;
						try {
							// Windows has no groups to signal; the tree goes by its root.
							if (process.platform === "win32") {
								spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
									windowsHide: true,
								}).on("error", () => {});
							} else process.kill(-child.pid, name);
						} catch {
							// Already gone.
						}
					};
					function kill() {
						signal("SIGTERM");
						// Whatever ignores the polite request does not get a second one.
						setTimeout(() => signal("SIGKILL"), 2000).unref();
						settle(130);
					}
					if (abort?.aborted) kill();
					else abort?.addEventListener("abort", kill, { once: true });

					child.stdout?.setEncoding("utf8");
					child.stdout?.on("data", (chunk: string) => {
						if (settled) return;
						stdout.push(chunk);
						stream?.({ type: "stdout", value: chunk });
					});

					child.stderr?.setEncoding("utf8");
					child.stderr?.on("data", (chunk: string) => {
						if (settled) return;
						stderr.push(chunk);
						stream?.({ type: "stderr", value: chunk });
					});

					child.on("error", (error) => {
						const value = `${error.message}\n`;
						stderr.push(value);
						stream?.({ type: "stderr", value });
						settle(1);
					});

					child.on("close", (code) => {
						settle(code ?? 0);
					});
				});
			},
		};
	},
} as const;
