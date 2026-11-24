import type { Client } from "#client/client.ts";
import type {
	CapabilityFactory,
	ShellCapability,
} from "#core/core/types/capability.ts";
import type { FilesystemSpec } from "#core/features/file/types/file.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

export const createChatShellCapability: CapabilityFactory<
	{ client: Client } & FilesystemSpec,
	ShellCapability
> = async ({ client, ...spec }) => {
	/**
	 * Has the chat's file list and whatever is shown from its mount read again,
	 * after the mount changed. Only the user's view waits on it, not the tool.
	 */
	const refresh = () => {
		void client.queryClient.invalidateQueries({
			queryKey: ["useChatFiles", "chatFiles"],
		});
		void client.queryClient.invalidateQueries({
			predicate: ({ queryKey: [name, kind, path] }) =>
				name === "useFileViewer" &&
				kind === "data" &&
				typeof path === "string" &&
				PathUtils.isMounted(path),
		});
	};

	return {
		cwd: async () => {
			await client.workingDirectory.ready();
			return await client.api.file.cwd.query(spec);
		},
		folders: async () => {
			await client.workingDirectory.ready();
			return await client.api.file.folders.query(spec);
		},
		nodes: async () => {
			return await client.api.file.getFiles.query(spec);
		},

		readFile: async ({ path }) => {
			const file = await client.api.file.getFile.query({ ...spec, path });
			return {
				path: file.uri,
				data: file.data,
			};
		},

		readDir: async ({ path }) => {
			const dir = await client.api.file.getDirectory.query({ ...spec, path });
			return dir.map((item) => ({
				path: item.uri,
				is_dir: item.isDirectory,
			}));
		},

		writeFile: async ({ path, content }) => {
			try {
				await client.api.file.writeFile.mutate({ ...spec, path, content });
			} finally {
				refresh();
			}
			return { path, success: true };
		},

		rename: async ({ path, to }) => {
			try {
				return {
					path: await client.api.file.rename.mutate({ ...spec, path, to }),
					success: true,
				};
			} finally {
				refresh();
			}
		},

		remove: async ({ path }) => {
			try {
				return {
					path: await client.api.file.remove.mutate({ ...spec, path }),
					success: true,
				};
			} finally {
				refresh();
			}
		},

		exec: async ({ command, abort }) => {
			await client.workingDirectory.ready();
			try {
				return await client.api.file.exec.mutate(
					{ ...spec, command },
					{ signal: abort },
				);
			} finally {
				refresh();
			}
		},
	};
};
