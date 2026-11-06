import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const which = (program: string) =>
	(process.env.PATH ?? "")
		.split(delimiter)
		.some((dir) => dir && existsSync(join(dir, program)));

const isWsl = (() => {
	if (process.platform !== "linux") return false;
	if (process.env.WSL_DISTRO_NAME) return true;
	try {
		return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
	} catch {
		return false;
	}
})();

/** Runs `command` without waiting on it, answering whether it started. */
const run = ([program, ...args]: string[]) =>
	new Promise<boolean>((resolve) => {
		if (!program) return resolve(false);
		const child = spawn(program, args, { stdio: "ignore", detached: true });
		child.once("error", () => resolve(false));
		child.once("spawn", () => {
			child.unref();
			resolve(true);
		});
	});

/** The commands that may open `target`, best first. */
const commands = (target: string): string[][] => {
	if (process.platform === "darwin") return [["open", target]];
	if (process.platform === "win32") return [["cmd", "/C", "start", "", target]];
	if (isWsl) {
		// Windows' own apps, since WSLg rarely has a viewer of its own installed.
		const path = target.startsWith("file:") ? fileURLToPath(target) : null;
		return [
			...(which("wslview") ? [["wslview", path ?? target]] : []),
			...(path
				? [["sh", "-c", 'explorer.exe "$(wslpath -w "$1")"', "sh", path]]
				: [["explorer.exe", target]]),
			["xdg-open", target],
		];
	}
	return [["xdg-open", target]];
};

/** Hands URLs and files to the system, which opens them in their default app. */
export const OpenerService = {
	/** Opens `target`, a URL or `file:` URL, answering whether anything took it. */
	open: async (target: string) => {
		for (const command of commands(target)) {
			if (await run(command)) return true;
		}
		console.warn("[OpenerService] nothing could open", target.slice(0, 200));
		return false;
	},
} as const;
