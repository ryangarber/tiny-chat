import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { LaunchStatsService } from "#client/features/launch/services/LaunchStatsService.ts";
import type { ClientLaunch } from "#client/features/launch/types/launch.ts";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";
import {
	type ShellLauncher,
	ShellLaunchUtils,
	WINDOWS_SHELLS,
} from "#client/features/shell/utils/ShellLaunchUtils.ts";
import type {
	zLaunchProcess,
	zLaunchSignal,
	zLaunchState,
	zLaunchStatus,
} from "#core/features/tool/types/launch.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";

/** Output kept per launch: the end of it, which is what anyone reads. */
const MAX_OUTPUT = 256 * 1024;
const STOP_TIMEOUT_MS = 5000;
/** How long a process that ignored SIGKILL is waited on before giving up. */
const KILL_WAIT_MS = 2000;

const windows = process.platform === "win32";

type Run = {
	id: string;
	script: string;
	cwd: string;
	state: zLaunchState;
	child: ChildProcess | null;
	pid: number | null;
	startedAt: number;
	endedAt: number | null;
	code: number | null;
	signal: string | null;
	output: string;
	/** Settles once the process has exited. */
	exited: Promise<void>;
	/** Whoever asked it to stop, so its end reads as stopped rather than exited. */
	stopping: boolean;
};

/**
 * Sends a signal to a launch and everything it started: its process group on
 * macOS and Linux, its tree on Windows, which has no signals to send but the
 * end of a process.
 */
const send = (pid: number, signal: zLaunchSignal | "SIGKILL") => {
	if (windows) {
		if (!["SIGINT", "SIGTERM", "SIGKILL", "SIGQUIT"].includes(signal)) {
			throw new Error(`Windows cannot send ${signal}; only stop the launch.`);
		}
		spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
			windowsHide: true,
		});
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {
		// The group is gone; the root may still be on its way out.
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
};

/**
 * Whether anything is left in a launch's process group. A shell that ran its
 * script's commands can be gone while they go on, reparented away from it.
 */
const groupAlive = (pid: number) => {
	if (windows) return false;
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

/** How often a group whose shell has exited is checked for what is left. */
const GROUP_POLL_MS = 250;

const within = (promise: Promise<void>, ms: number) =>
	Promise.race([
		promise.then(() => true),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
	]);

export const LaunchHostService = {
	/**
	 * Launches for a host with Node's APIs, which run their scripts in the
	 * user's shell, each in its own process group so that stopping one stops
	 * everything it started. They are stopped when the host exits.
	 *
	 * @param login Runs scripts in the user's login shell environment, for an
	 * 	app that may have been launched outside a terminal (see
	 * 	`NodeShellService`).
	 */
	create: ({ login = false }: { login?: boolean } = {}): ClientLaunch => {
		const runs = new Map<string, Run>();
		const primitives = NodeShellService.create({ login });

		const native: Promise<ShellLauncher> =
			primitives.os === "windows"
				? Promise.all([
						primitives.locate({ paths: WINDOWS_SHELLS.gitBash }),
						primitives.locate({ paths: WINDOWS_SHELLS.pwsh }),
					]).then(([gitBash, pwsh]) =>
						ShellLaunchUtils.native({ os: "windows", gitBash, pwsh }),
					)
				: Promise.resolve(ShellLaunchUtils.native({ os: primitives.os }));

		// Nothing started here outlives the host. `exit` allows no waiting, so
		// each group is killed outright.
		process.once("exit", () => {
			for (const run of runs.values()) {
				if (run.pid !== null && LaunchUtils.isActive(run.state)) {
					try {
						send(run.pid, "SIGKILL");
					} catch {
						// Nothing more to do on the way out.
					}
				}
			}
		});

		const append = (run: Run, chunk: string) => {
			run.output += chunk;
			if (run.output.length > MAX_OUTPUT) {
				const cut = run.output.indexOf("\n", run.output.length - MAX_OUTPUT);
				run.output = run.output.slice(
					cut === -1 ? run.output.length - MAX_OUTPUT : cut + 1,
				);
			}
		};

		const toStatus = async (runList: (Run | undefined)[], ids: string[]) => {
			const live = runList.filter(
				(run): run is Run =>
					!!run && run.pid !== null && LaunchUtils.isActive(run.state),
			);
			const stats = await LaunchStatsService.get(
				live.map((run) => run.pid as number),
			).catch(() => new Map());
			return ids.map((id, index): zLaunchStatus => {
				const run = runList[index];
				if (!run) return LaunchUtils.idle(id);
				const active = LaunchUtils.isActive(run.state);
				const used =
					active && run.pid !== null ? stats.get(run.pid) : undefined;
				return {
					id,
					state: run.state,
					pid: active ? run.pid : null,
					startedAt: run.startedAt,
					endedAt: run.endedAt,
					code: run.code,
					signal: run.signal,
					ports: used?.ports ?? [],
					cpu: used ? used.cpu : null,
					memory: used ? used.memory : null,
					processes: used?.pids.length ?? (active ? 1 : 0),
				};
			});
		};

		const status = async (id: string) =>
			(await toStatus([runs.get(id)], [id]))[0] as zLaunchStatus;

		const start = async ({ id, script, cwd }: zLaunchProcess) => {
			const existing = runs.get(id);
			if (existing && LaunchUtils.isActive(existing.state)) {
				// A run being stopped is let finish, then started anew.
				if (existing.state === "running") return await status(id);
				await existing.exited;
			}

			const directory = cwd || homedir();
			const launcher = ShellLaunchUtils.forDirectory({
				path: directory,
				native: await native,
			});
			const shell = launcher.exec({ command: script, cwd: directory });
			const env = await NodeShellService.env({ env: shell.env, login });

			let markExited = () => {};
			const run: Run = {
				id,
				script,
				cwd: directory,
				state: "running",
				child: null,
				pid: null,
				startedAt: Date.now(),
				endedAt: null,
				code: null,
				signal: null,
				output: "",
				exited: new Promise((resolve) => {
					markExited = resolve;
				}),
				stopping: false,
			};
			runs.set(id, run);

			const finish = (code: number | null, signal: string | null) => {
				if (run.endedAt !== null) return;
				run.endedAt = Date.now();
				run.code = code;
				run.signal = signal;
				run.state = run.stopping ? "stopped" : "exited";
				run.child = null;
				markExited();
			};
			// The run lasts as long as its group does, not only its shell.
			let rooted = true;
			const end = (code: number | null, signal: string | null) => {
				if (!rooted) return;
				rooted = false;
				if (run.pid === null || !groupAlive(run.pid)) {
					finish(code, signal);
					return;
				}
				const timer = setInterval(() => {
					if (run.pid !== null && groupAlive(run.pid)) return;
					clearInterval(timer);
					finish(code, signal);
				}, GROUP_POLL_MS);
				timer.unref?.();
			};

			let child: ChildProcess;
			try {
				child = spawn(shell.program, shell.args, {
					cwd: shell.cwd,
					env,
					// Its own group, so a signal reaches what the shell started.
					detached: !windows,
					windowsHide: true,
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch (error) {
				append(run, `${error instanceof Error ? error.message : error}\n`);
				finish(1, null);
				return await status(id);
			}
			run.child = child;
			run.pid = child.pid ?? null;

			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => append(run, chunk));
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (chunk: string) => append(run, chunk));
			child.on("error", (error) => {
				append(run, `${error.message}\n`);
				end(1, null);
			});
			child.on("exit", (code, signal) => end(code, signal));

			return await status(id);
		};

		const stop = async ({
			id,
			signal = "SIGTERM",
			timeout = STOP_TIMEOUT_MS,
		}: {
			id: string;
			signal?: zLaunchSignal;
			timeout?: number;
		}) => {
			const run = runs.get(id);
			if (!run || run.pid === null || !LaunchUtils.isActive(run.state)) {
				return await status(id);
			}
			run.stopping = true;
			run.state = "stopping";
			send(run.pid, signal);
			if (!(await within(run.exited, timeout))) {
				send(run.pid, "SIGKILL");
				await within(run.exited, KILL_WAIT_MS);
			}
			return await status(id);
		};

		return {
			status: async ({ ids }) =>
				await toStatus(
					ids.map((id) => runs.get(id)),
					ids,
				),
			start,
			restart: async (launch) => {
				await stop({ id: launch.id });
				return await start(launch);
			},
			stop,
			signal: async ({ id, signal }) => {
				const run = runs.get(id);
				if (!run || run.pid === null || !LaunchUtils.isActive(run.state)) {
					throw new Error("The launch is not running.");
				}
				send(run.pid, signal);
				return await status(id);
			},
			logs: async ({ id, lines }) => {
				const output = runs.get(id)?.output ?? "";
				return lines ? LaunchUtils.tail(output, lines) : output;
			},
		};
	},
} as const;
