import { z } from "zod";
import { Enum } from "#core/core/services/PostgresService.ts";
import { zId } from "#core/core/types/common.ts";
import { ChatLike } from "#core/features/data/types/chat.ts";
import { MessageLike, zConfig } from "#core/features/data/types/message.ts";
import { zData, zMetadata } from "#core/features/data/types/part.ts";
import { MessageService } from "#server/features/message/services/MessageService.ts";
import { procedure, router } from "#server/index.ts";

export const message = router({
	getMessages: procedure
		.input(
			z.object({
				chat: ChatLike.nullish(),
				start: zId.optional(),
				/** Only the messages past this one, for a caller holding the rest. */
				after: zId.nullish(),
				branches: z.record(z.string(), z.string()).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			if (!input.chat) {
				return {
					messages: [],
					branchOptions: {} as Record<string, string[]>,
				};
			}

			return await MessageService.getMessages({
				user: ctx.session.user,
				chat: input.chat,
				start: input.start,
				after: input.after,
				branches: input.branches,
			});
		}),

	locateMessage: procedure
		.input(z.object({ message: MessageLike }))
		.query(async ({ ctx, input }) => {
			return await MessageService.locateMessage({
				user: ctx.session.user,
				message: input.message,
			});
		}),

	// TODO - zData inferring as `unknown[][]` in FilesystemService.test.ts
	//  	  could this be related the tool part issue?
	createMessage: procedure
		.input(
			z.object({
				chat: ChatLike.nullish(),
				projectId: z.string().nullish(),
				author: z.enum(Enum.Author.values),
				config: zConfig,
				data: zData,
				metadata: zMetadata.optional(),
				previous: MessageLike.nullish(),
				temporary: z.boolean().optional(),
				incognito: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return await MessageService.createMessage({
				user: ctx.session.user,
				origin: ctx.origin,
				chat: input.chat,
				projectId: input.projectId,
				author: input.author,
				config: input.config,
				data: input.data,
				metadata: input.metadata,
				previous: input.previous,
				temporary: input.temporary,
				incognito: input.incognito,
			});
		}),

	editMessage: procedure
		.input(
			z.object({
				message: MessageLike,
				author: z.enum(Enum.Author.values),
				config: zConfig,
				data: zData,
				metadata: zMetadata.optional(),
				truncate: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return await MessageService.editMessage({
				user: ctx.session.user,
				origin: ctx.origin,
				message: input.message,
				author: input.author,
				config: input.config,
				data: input.data,
				metadata: input.metadata,
				truncate: input.truncate,
			});
		}),

	updateMessage: procedure
		.input(
			z.object({
				message: MessageLike,
				author: z.enum(Enum.Author.values),
				config: zConfig,
				data: zData,
				/** Replaces the stored metadata. */
				metadata: zMetadata.optional(),
				/** Added to the stored metadata. */
				appendMetadata: zMetadata.optional(),
				truncate: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return await MessageService.updateMessage({
				user: ctx.session.user,
				origin: ctx.origin,
				message: input.message,
				author: input.author,
				config: input.config,
				data: input.data,
				metadata: input.metadata,
				appendMetadata: input.appendMetadata,
				truncate: input.truncate,
			});
		}),

	deleteMessage: procedure
		.input(MessageLike)
		.mutation(async ({ ctx, input }) => {
			return await MessageService.deleteMessage({
				user: ctx.session.user,
				origin: ctx.origin,
				message: input,
			});
		}),
});
