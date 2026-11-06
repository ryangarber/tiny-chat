export const VERBOSE = true;

export const LogLevel = {
	log: "log",
	info: "info",
	warn: "warn",
	error: "error",
	trace: "trace",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export type LogWriter = (
	time: string,
	level: LogLevel,
	...data: unknown[]
) => void;

type NodeModules = {
	fs: typeof import("node:fs");
	path: typeof import("node:path");
	os: typeof import("node:os");
	util: typeof import("node:util");
};

/**
 * Node's modules, loaded synchronously where the runtime can (Node 22.3+, Bun)
 * so a line is on disk before the next statement runs — including the last one
 * before the process exits. Elsewhere they are imported, a tick late.
 */
const loadNodeModules = (): NodeModules | Promise<NodeModules> => {
	const load = (globalThis as any).process?.getBuiltinModule as
		| ((id: string) => unknown)
		| undefined;
	if (typeof load === "function")
		return {
			fs: load("node:fs"),
			path: load("node:path"),
			os: load("node:os"),
			util: load("node:util"),
		} as NodeModules;
	return Promise.all([
		import(/* @vite-ignore */ "node:fs"),
		import(/* @vite-ignore */ "node:path"),
		import(/* @vite-ignore */ "node:os"),
		import(/* @vite-ignore */ "node:util"),
	]).then(([fs, path, os, util]) => ({ fs, path, os, util }));
};

export function createLogger({
	logWriter,
	logToDisk,
	silent,
	exitOnUncaught = true,
}: {
	logWriter?: LogWriter;
	logToDisk?: boolean;
	silent?: boolean;
	/**
	 * Whether an uncaught exception ends the process. A host that handles them
	 * itself (the CLI keeps running over a failed key or mouse handler) turns
	 * this off, or the logger would exit before its handler is ever reached.
	 */
	exitOnUncaught?: boolean;
} = {}) {
	if (!silent) console.log(":: creating logger...");

	const levels = Object.values(LogLevel);

	for (const level of levels) {
		const original = console[level].bind(console);

		const replaced = (...data: unknown[]) => {
			const time = new Date().toISOString().split("T")[1].split(".")[0];

			logWriter?.(time, level, ...data);

			if (typeof process !== "undefined" && logToDisk) {
				const write = ({ fs, path, os, util }: NodeModules) => {
					try {
						const { appendFileSync, existsSync, mkdirSync } = fs;
						const { resolve } = path;
						const { tmpdir } = os;
						const { inspect } = util;

						const date = new Date().toISOString().split("T")[0];
						const file = resolve(tmpdir(), `tiny-chat/${date}.log`);
						mkdirSync(resolve(tmpdir(), "tiny-chat"), { recursive: true });
						if (!silent && !existsSync(file))
							original("⁝ Writing logs to:", file);

						data = data.map((d) => {
							return typeof d === "object" && d !== null ? inspect(d) : d;
						});

						appendFileSync(
							file,
							`[${time}] ${level.toUpperCase()}: ${data.join(" ")}\n`,
						);
					} catch (error) {
						original("⁝ INTERNAL ⁝", error);
					}
				};
				const modules = loadNodeModules();
				if (modules instanceof Promise)
					void modules.then(write, (error: unknown) =>
						original("⁝ INTERNAL ⁝", error),
					);
				else write(modules);
			}
		};

		console[level] = (...data: unknown[]) => {
			if (!silent) original(...data);
			replaced(...data);
		};

		if (level === "error") {
			const globals = globalThis as any;

			if (
				typeof globals.window !== "undefined" &&
				typeof globals.window?.addEventListener === "function"
			) {
				console.log("⁝ Using browser logging");
				globals.window?.addEventListener("error", (error: unknown) =>
					console.error("⁝ UNCAUGHT ⁝", error),
				);
				globals.window?.addEventListener(
					"unhandledrejection",
					(error: unknown) => console.error("[UNCAUGHT]", error),
				);
			}

			if (
				typeof globals.process !== "undefined" &&
				typeof globals.process.on === "function"
			) {
				console.log("⁝ Using native logging");
				globals.process?.on("uncaughtException", (error: unknown) => {
					console.error("⁝ UNCAUGHT ⁝", error);
					if (exitOnUncaught) globals.process.exit(1);
				});
				globals.process?.on(
					"unhandledRejection",
					(reason: unknown, promise: Promise<unknown>) => {
						console.error("⁝ UNCAUGHT ⁝", promise, reason);
					},
				);
			}
		}
	}
}
