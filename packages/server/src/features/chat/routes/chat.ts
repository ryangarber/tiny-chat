import { z } from "zod";
import { zId } from "#core/core/types/common.ts";
import type { ChatEvent } from "#core/features/data/types/chat.ts";
import { ChatLike, ProjectLike } from "#core/features/data/types/chat.ts";
import { ChatEventService } from "#server/features/chat/services/ChatEventService.ts";
import { ChatSearchService } from "#server/features/chat/services/ChatSearchService.ts";
import { ChatService } from "#server/features/chat/services/ChatService.ts";
import { FileService } from "#server/features/file/services/FileService.ts";
import { procedure, router } from "#server/index.ts";

export const chat = router({
	activate: procedure
		.input(
			z.object({
				chatId: z.string().nullish(),
				projectId: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const project = await ChatService.getWorkingDirectory({
				user: ctx.session.user,
				chat: input.chatId,
				project: input.projectId,
			});
			if (input.chatId) FileService.activate(ctx.session.user.id, input.chatId);
			return project;
		}),

	/**
	 * What changes among the user's chats, as it happens. The chat an instance
	 * has open is named by `viewing`: it is caught up on as it is written to,
	 * for as long as this is listened to.
	 */
	onEvent: procedure
		.input(z.object({ viewing: z.string().nullish() }))
		.subscription(async function* ({
			ctx,
			input,
			signal,
		}): AsyncGenerator<ChatEvent> {
			const userId = ctx.session.user.id;
			const release = input.viewing
				? await ChatEventService.view(userId, input.viewing)
				: undefined;
			try {
				yield* ChatEventService.listen(userId, signal);
			} catch (error) {
				// Ending the subscription aborts the wait for the next event.
				if (!signal?.aborted) throw error;
			} finally {
				release?.();
			}
		}),

	createProject: procedure.mutation(({ ctx }) =>
		ChatService.createProject({ user: ctx.session.user }),
	),

	getChat: procedure.input(ChatLike).query(async ({ ctx, input }) => {
		return await ChatService.getChat({
			user: ctx.session.user,
			chat: input,
		});
	}),

	getChatList: procedure
		.input(
			z
				.object({ limit: z.number().optional(), cursor: zId.optional() })
				.default({}),
		)
		.query(async ({ ctx, input }) => {
			return await ChatService.getChats({
				user: ctx.session.user,
				limit: input.limit,
				cursor: input.cursor,
			});
		}),

	searchChats: procedure
		.input(
			z.object({
				searchText: z.string(),
				searchEmbedding: z.array(z.number()).optional(),
				limit: z.number().optional(),
				cursor: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			return await ChatSearchService.searchChats({
				user: ctx.session.user,
				searchText: input.searchText,
				searchEmbedding: input.searchEmbedding,
				limit: input.limit,
				cursor: input.cursor,
			});
		}),

	setChatTitle: procedure
		.input(z.object({ chat: ChatLike, title: z.string() }))
		.mutation(async ({ ctx, input }) => {
			return await ChatService.setChatTitle({
				user: ctx.session.user,
				chat: input.chat,
				title: input.title,
			});
		}),

	setChatProject: procedure
		.input(z.object({ chat: ChatLike, projectId: zId.nullable() }))
		.mutation(async ({ ctx, input }) => {
			return await ChatService.setChatProject({
				user: ctx.session.user,
				chat: input.chat,
				projectId: input.projectId,
			});
		}),

	deleteChat: procedure.input(ChatLike).mutation(async ({ ctx, input }) => {
		return await ChatService.deleteChat({
			user: ctx.session.user,
			chat: input,
		});
	}),

	updateProject: procedure
		.input(
			z.object({
				project: ProjectLike,
				title: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return await ChatService.updateProject({
				user: ctx.session.user,
				project: input.project,
				title: input.title,
			});
		}),

	deleteProject: procedure
		.input(z.object({ project: ProjectLike, deleteChats: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			return await ChatService.deleteProject({
				user: ctx.session.user,
				project: input.project,
				deleteChats: input.deleteChats,
			});
		}),
});
