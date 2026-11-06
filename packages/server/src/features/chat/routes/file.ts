import { z } from "zod";
import type { FileNode, FileState } from "#core/features/file/types/file.ts";
import { PathLike } from "#core/features/file/utils/PathUtils.ts";
import { FileService } from "#server/features/file/services/FileService.ts";
import { procedure, router } from "#server/index.ts";

/**
 * Which filesystem to build, as the client asks for it: the uploads and skills
 * a message points into, and the chat to write in. The ids arrive straight out
 * of message text, so every one of them is checked against the caller's own
 * files before it mounts anything.
 */
const Filesystem = z.object({
	chat: z.string().nullish(),
	uploads: z.array(z.string()).optional(),
	skills: z.array(z.string()).optional(),
});

export const file = router({
	cwd: procedure
		.input(Filesystem)
		.query(({ ctx, input }) =>
			FileService.cwd({ user: ctx.session.user, ...input }),
		),
	folders: procedure
		.input(Filesystem)
		.query(({ ctx, input }) =>
			FileService.folders({ user: ctx.session.user, ...input }),
		),
	getFile: procedure
		.input(Filesystem.extend({ path: PathLike }))
		.output(z.custom<FileState>())
		.query(async ({ ctx, input }) => {
			return await FileService.getFile({ user: ctx.session.user, ...input });
		}),

	getFiles: procedure
		.input(Filesystem)
		.output(z.custom<FileNode[]>())
		.query(async ({ ctx, input }) => {
			return await FileService.getFiles({ user: ctx.session.user, ...input });
		}),

	getDirectory: procedure
		.input(Filesystem.extend({ path: PathLike }))
		.query(async ({ ctx, input }) => {
			return await FileService.getDirectory({
				user: ctx.session.user,
				...input,
			});
		}),

	writeFile: procedure
		.input(Filesystem.extend({ path: PathLike, content: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await FileService.writeFile({ user: ctx.session.user, ...input });
		}),

	rename: procedure
		.input(Filesystem.extend({ path: PathLike, to: PathLike }))
		.mutation(async ({ ctx, input }) => {
			return await FileService.rename({ user: ctx.session.user, ...input });
		}),

	remove: procedure
		.input(Filesystem.extend({ path: PathLike }))
		.mutation(async ({ ctx, input }) => {
			return await FileService.remove({ user: ctx.session.user, ...input });
		}),

	exec: procedure
		.input(Filesystem.extend({ command: z.string() }))
		// The signal fires when the client drops the request, which is how a
		// user interrupting the command reaches the shell running it.
		.mutation(async ({ ctx, input, signal }) => {
			return await FileService.exec({
				user: ctx.session.user,
				...input,
				abort: signal,
			});
		}),
});
