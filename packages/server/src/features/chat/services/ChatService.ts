import { or } from "@prisma/orm-postgres/orm-client";
import { TRPCError } from "@trpc/server";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type {
	ChatLike,
	ChatState,
	ProjectLike,
	ProjectState,
} from "#core/features/data/types/chat.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { ChatEventService } from "#server/features/chat/services/ChatEventService.ts";
import { ChatUtils } from "#server/features/chat/utils/ChatUtils.ts";

export const ChatService = {
	/**
	 * Get a chat by itself or any of its messages.
	 */
	getChat: async ({
		user,
		chat: chatLike,
	}: {
		user: zUser;
		chat: ChatLike;
	}): Promise<ChatState> => {
		if (typeof chatLike === "string") chatLike = { id: chatLike };

		const chat = await globalThis.db.orm.public.Chat.where({
			userId: user.id,
		})
			.where((chat) =>
				or(
					chat.id.eq(chatLike.id),
					chat.messages.some((message) => message.id.eq(chatLike.id)),
				),
			)
			.include("messages", (message) =>
				message.select("createdAt", "updatedAt"),
			)
			.include("project", (project) => project.select("title", "settings"))
			.first();

		if (!chat) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: `no chat or message with id ${chatLike.id}`,
			});
		}

		return ChatUtils.toChatState(chat);
	},

	getChats: async ({
		user,
		limit,
		cursor,
	}: {
		user: zUser;
		limit?: number;
		cursor?: string;
	}): Promise<{
		projects: ProjectState[];
		chats: ChatState[];
		nextCursor: string | null;
	}> => {
		const [projectRows, chatRows] = await Promise.all([
			cursor
				? []
				: db.orm.public.Project.where({ userId: user.id })
						.include("chats", (chat) =>
							chat
								.where({ temporary: false })
								.include("messages", (message) =>
									message.select("createdAt", "updatedAt"),
								)
								.include("project", (project) =>
									project.select("title", "settings"),
								),
						)
						.orderBy((f) => f.createdAt.desc())
						.all(),
			db.orm.public.Chat.where({
				userId: user.id,
				projectId: null,
				temporary: false,
			})
				.include("messages", (message) =>
					message.select("createdAt", "updatedAt"),
				)
				.include("project", (project) => project.select("title", "settings"))
				.all(),
		]);

		const timestamp = (chat: ChatState) => {
			return Math.max(
				chat.createdAt.toZonedDateTime("UTC").epochMilliseconds,
				...chat.messages.map(
					(message) =>
						message.createdAt.toZonedDateTime("UTC").epochMilliseconds,
				),
			);
		};

		const sortChats = (chats: ChatState[]) => {
			return chats.sort(
				(a, b) => timestamp(b) - timestamp(a) || a.id.localeCompare(b.id),
			);
		};

		// Most recently active first, by their latest chat; a project with none
		// counts from when it was made.
		const projects = projectRows
			.map((project) => ({
				...project,
				chats: sortChats(project.chats.map(ChatUtils.toChatState)),
			}))
			.map((project) => ({
				project,
				activeAt: Math.max(
					project.createdAt.toZonedDateTime("UTC").epochMilliseconds,
					...project.chats.map(timestamp),
				),
			}))
			.sort(
				(a, b) =>
					b.activeAt - a.activeAt || a.project.id.localeCompare(b.project.id),
			)
			.map(({ project }) => project);
		const chats = sortChats(chatRows.map(ChatUtils.toChatState));

		const start = cursor
			? Math.max(
					0,
					chats.findIndex((chat) => chat.id === cursor),
				)
			: 0;
		const end = limit ? start + limit : chats.length;

		return {
			projects,
			chats: chats.slice(start, end),
			nextCursor: chats[end]?.id ?? null,
		};
	},

	/**
	 * Set the title of a chat.
	 */
	setChatTitle: async ({
		user,
		chat,
		title,
	}: {
		user: zUser;
		chat: ChatLike;
		title: string;
	}) => {
		const { id } = await ChatService.getChat({
			user,
			chat,
		});
		await globalThis.db.orm.public.Chat.where({ id }).update({ title });
		ChatEventService.list(user.id);
	},

	setChatProject: async ({
		user,
		chat,
		projectId,
	}: {
		user: zUser;
		chat: ChatLike;
		projectId: string | null;
	}) => {
		const { id } = await ChatService.getChat({ user, chat });
		if (projectId) {
			const project = await globalThis.db.orm.public.Project.where({
				id: projectId,
				userId: user.id,
			})
				.select("id")
				.first();
			if (!project) throw new Error(`no project with id ${projectId}`);
		}
		await globalThis.db.orm.public.Chat.where({ id }).update({ projectId });
		ChatEventService.list(user.id);
	},

	/**
	 * Delete a chat, preserving its project.
	 */
	deleteChat: async ({ user, chat }: { user: zUser; chat: ChatLike }) => {
		if (typeof chat === "string") chat = { id: chat };
		const id = chat.id;
		await globalThis.db.transaction(async (tx) => {
			const existing = await tx.orm.public.Chat.where({ userId: user.id, id })
				.select("id")
				.first();
			if (!existing) return;
			const messages = await tx.orm.public.Message.where({
				chatId: id,
				userId: user.id,
			})
				.select("id")
				.all();
			if (messages.length) {
				// TODO - confirm relations delete and remove this
				await tx.orm.public.MessageContext.where((link) =>
					link.messageId.in(messages.map((message) => message.id)),
				).deleteAll();
				await tx.orm.public.DreamMessage.where((link) =>
					link.messageId.in(messages.map((message) => message.id)),
				).deleteAll();
			}
			await tx.orm.public.Chat.where({ userId: user.id, id }).delete();
		});
		ChatEventService.list(user.id);
	},

	createProject: async ({ user, title }: { user: zUser; title?: string }) => {
		const project = await globalThis.db.orm.public.Project.create({
			id: CommonUtils.getRandomId(),
			userId: user.id,
			title,
		});
		ChatEventService.list(user.id);
		return project;
	},

	getWorkingDirectory: async ({
		user,
		chat,
		project,
	}: {
		user: zUser;
		chat?: string | null;
		project?: string | null;
	}) => {
		const selected = chat ? await ChatService.getChat({ user, chat }) : null;
		const id = selected ? selected.projectId : project;
		const row = id
			? await globalThis.db.orm.public.Project.where({
					id,
					userId: user.id,
				}).first()
			: null;
		const { folders } = SettingsUtils.of(user, row);
		return {
			id: row?.id ?? null,
			candidates: SettingsUtils.primaryCandidates(user, row),
			// A runtime launched inside one of these starts there instead.
			projectCandidates: SettingsUtils.primaryCandidates(null, row),
			folders,
		};
	},

	updateProject: async ({
		user,
		project,
		title,
	}: {
		user: zUser;
		project: ProjectLike;
		title: string;
	}) => {
		if (typeof project === "string") project = { id: project };
		await globalThis.db.orm.public.Project.where({
			userId: user.id,
			id: project.id,
		}).update({ title });
		ChatEventService.list(user.id);
	},

	deleteProject: async ({
		user,
		project,
		deleteChats,
	}: {
		user: zUser;
		project: ProjectLike;
		deleteChats: boolean;
	}) => {
		if (typeof project === "string") project = { id: project };
		if (deleteChats) {
			await globalThis.db.orm.public.Chat.where({
				userId: user.id,
				projectId: project.id,
			}).deleteAll();
		}
		await globalThis.db.orm.public.Project.where({
			userId: user.id,
			id: project.id,
		}).delete();
		ChatEventService.list(user.id);
	},
} as const;
