import type {
	CapabilityFactory,
	ShellCapability,
} from "#core/core/types/capability.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import type { FilesystemSpec } from "#core/features/file/types/file.ts";
import { FileService } from "#server/features/file/services/FileService.ts";

export const createChatShellCapability: CapabilityFactory<
	{ user: zUser } & FilesystemSpec,
	ShellCapability
> = async ({ user, ...spec }) => {
	return {
		cwd: () => FileService.cwd({ user, ...spec }),
		folders: () => FileService.folders({ user, ...spec }),
		nodes: async () => {
			return await FileService.getFiles({ user, ...spec });
		},

		readFile: async ({ path }) => {
			const file = await FileService.getFile({ user, ...spec, path });
			return {
				path: file.uri,
				data: file.data,
			};
		},

		readDir: async ({ path }) => {
			const dir = await FileService.getDirectory({ user, ...spec, path });
			return dir.map((item) => ({
				path: item.uri,
				is_dir: item.isDirectory,
			}));
		},

		writeFile: async ({ path, content }) => {
			await FileService.writeFile({ user, ...spec, path, content });
			return { path, success: true };
		},

		rename: async ({ path, to }) => ({
			path: await FileService.rename({ user, ...spec, path, to }),
			success: true,
		}),

		remove: async ({ path }) => ({
			path: await FileService.remove({ user, ...spec, path }),
			success: true,
		}),

		exec: async ({ command, abort }) => {
			return await FileService.exec({ user, ...spec, command, abort });
		},
	};
};
