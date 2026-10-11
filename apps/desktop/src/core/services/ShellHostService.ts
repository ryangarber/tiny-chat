import { homedir } from "node:os";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

const base64 = (data: Uint8Array) => Buffer.from(data).toString("base64");

export const ShellHostService = {
	/**
	 * The device's shell and file system, for the webview's `ClientShell`. An
	 * app started from Finder or the Dock has a bare environment, so commands
	 * run in the user's login shell's; and its own directory is inside the app
	 * bundle, so the shell starts at home.
	 */
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<
		| "cwd"
		| "resolveDir"
		| "locate"
		| "readFile"
		| "readFiles"
		| "readDir"
		| "walk"
		| "writeFile"
		| "spawn"
		| "kill"
	> => {
		const shell = NodeShellService.create({ login: true });
		const running = new Map<string, AbortController>();

		return {
			cwd: async () => homedir(),
			resolveDir: (params) => shell.resolveDir(params),
			locate: (params) => shell.locate(params),
			readFile: async (params) => {
				const { path, data } = await shell.readFile(params);
				return { path, data: base64(data) };
			},
			readFiles: async (params) =>
				(await shell.readFiles?.(params))?.map(
					(file) => file && { data: base64(file.data), size: file.size },
				) ?? [],
			readDir: (params) => shell.readDir(params),
			walk: async (params) => {
				if (!shell.walk) throw new Error("walk is not supported");
				return await shell.walk(params);
			},
			writeFile: (params) => shell.writeFile(params),
			spawn: async ({ id, ...params }) => {
				const abort = new AbortController();
				running.set(id, abort);
				try {
					return await shell.spawn({
						...params,
						abort: abort.signal,
						stream: ({ type, value }) => send.spawnOutput({ id, type, value }),
					});
				} finally {
					running.delete(id);
				}
			},
			kill: async ({ id }) => {
				running.get(id)?.abort();
			},
		};
	},
} as const;
