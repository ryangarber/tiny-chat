import { describe, expect, it } from "vitest";
import {
	type HostShellPrimitives,
	HostShellService,
} from "#client/features/shell/services/HostShellService.ts";
import type { ShellProcess } from "#client/features/shell/utils/ShellLaunchUtils.ts";

/**
 * Primitives over a made-up machine: `dirs` are the directories that exist,
 * `files` the files, and every call is recorded with the path it was given.
 */
const create = ({
	os = "linux",
	start,
	dirs = [],
	files = [],
	tmpdir,
}: {
	os?: HostShellPrimitives["os"];
	start: string;
	dirs?: string[];
	files?: string[];
	tmpdir?: string;
}) => {
	const calls: { method: string; path: string }[] = [];
	const spawned: ShellProcess[] = [];
	const primitives: HostShellPrimitives = {
		os,
		tmpdir: tmpdir ? async () => tmpdir : undefined,
		cwd: async () => start,
		resolveDir: async ({ path }) => {
			const resolved = path.replace(/[\\/][^\\/]+[\\/]\.\.$/, "");
			if (!dirs.includes(resolved)) throw new Error(`Not a directory: ${path}`);
			return resolved;
		},
		locate: async ({ paths }) =>
			paths.find((path) => files.includes(path)) ?? null,
		readFile: async ({ path }) => {
			calls.push({ method: "readFile", path });
			return { path, data: new Uint8Array() };
		},
		readDir: async ({ path }) => {
			calls.push({ method: "readDir", path });
			return [{ path: `${path}\\child`, is_dir: false }];
		},
		writeFile: async ({ path }) => {
			calls.push({ method: "writeFile", path });
			return { path, success: true };
		},
		rename: async ({ path, to }) => {
			calls.push({ method: "rename", path });
			return { path: to, success: true };
		},
		remove: async ({ path }) => {
			calls.push({ method: "remove", path });
			return { path, success: true };
		},
		spawn: async ({ program, args, cwd, env }) => {
			spawned.push({ program, args, cwd, env });
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	return { shell: HostShellService.create(primitives), calls, spawned };
};

describe("HostShellService", () => {
	it("starts where the runtime started", async () => {
		const { shell } = create({ start: "/home/me" });
		expect(await shell.cwd?.()).toBe("/home/me");
		expect(shell.environment?.().label).toBe("sh on Linux");
	});

	it("runs commands and resolves relative paths in its own directory", async () => {
		const { shell, calls, spawned } = create({
			start: "/home/me",
			dirs: ["/home/me/proj"],
		});
		await shell.chdir?.({ path: "proj" });
		await shell.exec({ command: "pwd" });
		await shell.readFile({ path: "README.md" });
		expect(spawned).toEqual([
			{ program: "/bin/sh", args: ["-c", "pwd"], cwd: "/home/me/proj" },
		]);
		expect(calls).toEqual([
			{ method: "readFile", path: "/home/me/proj/README.md" },
		]);
	});

	it("keeps its directory when asked to move somewhere that is not one", async () => {
		const { shell } = create({ start: "/home/me" });
		await expect(shell.chdir?.({ path: "/nope" })).rejects.toThrow();
		expect(await shell.cwd?.()).toBe("/home/me");
	});

	it("prefers an installed Git Bash on Windows, and speaks its paths", async () => {
		const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
		const { shell, calls, spawned } = create({
			os: "windows",
			start: "C:\\Users\\me",
			files: [bash],
		});
		expect(await shell.cwd?.()).toBe("/c/Users/me");
		expect(shell.environment?.().label).toBe("Git Bash on Windows");
		await shell.readFile({ path: "/c/Users/me/notes.txt" });
		await shell.readFile({ path: "D:\\x.txt" });
		await shell.exec({ command: "ls" });
		expect(calls.map((call) => call.path)).toEqual([
			"C:\\Users\\me\\notes.txt",
			"D:\\x.txt",
		]);
		expect(spawned[0]).toMatchObject({ program: bash, cwd: "C:\\Users\\me" });
	});

	it("spells the OS temp directory for Git Bash and WSL", async () => {
		const wsl = "\\\\wsl.localhost\\Ubuntu\\home\\me";
		const { shell } = create({
			os: "windows",
			start: "C:\\Users\\me",
			tmpdir: "C:\\Users\\me\\Temp",
			files: ["C:\\Program Files\\Git\\bin\\bash.exe"],
			dirs: [wsl],
		});
		expect(await shell.tmpdir?.()).toBe("/c/Users/me/Temp");
		await shell.chdir?.({ path: wsl });
		expect(await shell.tmpdir?.()).toBe("/mnt/c/Users/me/Temp");
	});

	it("falls back to Windows PowerShell", async () => {
		const { shell } = create({ os: "windows", start: "C:\\Users\\me" });
		await shell.cwd?.();
		expect(shell.environment?.()).toEqual({
			os: "windows",
			dialect: "powershell",
			label: "Windows PowerShell",
		});
		expect(shell.toShellPath?.({ path: "C:\\work" })).toBe("C:\\work");
	});

	it("moves into a WSL distro and back out", async () => {
		const unc = "\\\\wsl.localhost\\Ubuntu\\home\\me\\proj";
		const { shell, calls, spawned } = create({
			os: "windows",
			start: "C:\\Users\\me",
			dirs: [unc, "C:\\Users\\me"],
		});
		const original = await shell.cwd?.();

		await shell.chdir?.({ path: unc });
		expect(await shell.cwd?.()).toBe("/home/me/proj");
		expect(shell.environment?.().label).toBe("bash in WSL (Ubuntu) on Windows");
		expect(shell.toShellPath?.({ path: unc })).toBe("/home/me/proj");
		expect(shell.toShellPath?.({ path: "C:\\Users" })).toBe("/mnt/c/Users");

		await shell.exec({ command: "pwd" });
		await shell.run?.({ program: "git", args: ["status"] });
		expect(spawned).toEqual([
			{
				program: "wsl.exe",
				args: [
					"-d",
					"Ubuntu",
					"--cd",
					"/home/me/proj",
					"-e",
					"bash",
					"-lc",
					"pwd",
				],
			},
			{
				program: "wsl.exe",
				args: ["-d", "Ubuntu", "--cd", "/home/me/proj", "-e", "git", "status"],
			},
		]);

		// Reads go through the network path; what comes back is in Linux terms.
		const file = await shell.readFile({ path: "src/a.ts" });
		const listing = await shell.readDir({ path: "/home/me/proj" });
		expect(calls.map((call) => call.path)).toEqual([`${unc}\\src\\a.ts`, unc]);
		expect(file.path).toBe("/home/me/proj/src/a.ts");
		expect(listing[0].path).toBe("/home/me/proj/child");

		// The directory it started in is named the way the native shell named it.
		await shell.chdir?.({ path: original ?? "" });
		expect(await shell.cwd?.()).toBe("C:\\Users\\me");
		expect(shell.environment?.().dialect).toBe("powershell");
	});
});
