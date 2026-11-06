import type { Client } from "#client/client.ts";
import type {
	CapabilityFactory,
	ShellCapability,
} from "#core/core/types/capability.ts";
import type { FilesystemSpec } from "#core/features/file/types/file.ts";

export const createChatShellCapability: CapabilityFactory<
	{ client: Client } & FilesystemSpec,
	ShellCapability
> = async ({ client, ...spec }) => {
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
			await client.api.file.writeFile.mutate({ ...spec, path, content });
			return { path, success: true };
		},

		rename: async ({ path, to }) => ({
			path: await client.api.file.rename.mutate({ ...spec, path, to }),
			success: true,
		}),

		remove: async ({ path }) => ({
			path: await client.api.file.remove.mutate({ ...spec, path }),
			success: true,
		}),

		exec: async ({ command, abort }) => {
			await client.workingDirectory.ready();
			return await client.api.file.exec.mutate(
				{ ...spec, command },
				{ signal: abort },
			);
		},
	};
};
