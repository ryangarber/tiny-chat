import type { Enum } from "#core/core/services/PostgresService.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { ChatLike } from "#core/features/data/types/chat.ts";
import type { MessageLike } from "#core/features/data/types/message.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { MemoryRetrievalService } from "#server/features/chat/services/MemoryRetrievalService.ts";
import { MemoryUtils } from "#server/features/chat/utils/MemoryUtils.ts";

type MemoryInput = {
	user: zUser;
	message?: MessageLike | null;
	fact: string;
	category: Enum["MemoryCategory"];
	stability: Enum["MemoryStability"];
	evidence: string[];
	confidence: number;
};

export const MemoryService = {
	getMemories: async ({ user }: { user: zUser }) =>
		(
			await globalThis.db.orm.public.Memory.where({ userId: user.id }).all()
		).map(MemoryUtils.toMemoryState),

	/** Memories learned from the chat's messages, or retrieved into them. */
	getChatMemoryIds: async ({ user, chat }: { user: zUser; chat: ChatLike }) => {
		if (typeof chat === "string") chat = { id: chat };

		const existing = await globalThis.db.orm.public.Chat.where({
			id: chat.id,
			userId: user.id,
		})
			.select("incognito")
			.include("project", (project) => project.select("settings"))
			.first();
		if (!existing) return [];

		const messageIds = (
			await globalThis.db.orm.public.Message.where({
				chatId: chat.id,
				userId: user.id,
			})
				.select("id")
				.all()
		).map((message) => message.id);
		if (!messageIds.length) return [];
		const [learned, retrieved] = await Promise.all([
			globalThis.db.orm.public.Memory.where({ userId: user.id })
				.where((memory) => memory.messageId.in(messageIds))
				.select("id")
				.all(),
			existing.incognito
				? []
				: MemoryRetrievalService.retrieve({
						user,
						messages: messageIds.map((id) => ({ id })),
						tokens: SettingsUtils.of(user, existing.project).memoryBudget,
					}),
		]);
		return [
			...new Set([
				...learned.map((memory) => memory.id),
				...retrieved.flat().map((memory) => memory.id),
			]),
		];
	},

	createMemory: async (input: MemoryInput) => MemoryService.saveMemory(input),
	updateMemory: async (input: MemoryInput & { id: string }) =>
		MemoryService.saveMemory(input),

	saveMemory: async ({
		user,
		message,
		...input
	}: MemoryInput & { id?: string }) => {
		const { id, ...values } = input;
		const messageId = typeof message === "string" ? message : message?.id;
		const source = messageId
			? await globalThis.db.orm.public.Message.where({
					id: messageId,
					userId: user.id,
				})
					.select("id", "config", "createdAt")
					.first()
			: undefined;
		if (messageId && !source) throw new Error("Message not found");
		// Embed before opening the transaction. New/updated facts are immediately searchable.
		const embedding = await MemoryRetrievalService.embed({
			user,
			text: values.fact,
		});
		return globalThis.db.transaction(async (tx) => {
			const data = {
				...values,
				...(source
					? {
							messageId: source.id,
							config: source.config,
							createdAt: source.createdAt,
						}
					: {}),
			};
			const memory = id
				? await tx.orm.public.Memory.where({ id, userId: user.id }).update(data)
				: await tx.orm.public.Memory.create({
						...data,
						id: CommonUtils.getRandomId(),
						userId: user.id,
					});
			if (!memory) throw new Error("Memory not found");
			await tx.orm.public.Memory.where({
				id: memory.id,
				userId: user.id,
			}).update({ embedding: embedding ?? null });
			return MemoryUtils.toMemoryState(memory);
		});
	},

	deleteMemory: async ({ user, id }: { user: zUser; id: string }) =>
		globalThis.db.transaction(async (tx) => {
			const memory = await tx.orm.public.Memory.where({
				id,
				userId: user.id,
			}).first();
			if (!memory) throw new Error("Memory not found");
			await tx.orm.public.MessageContext.where({ memoryId: id }).deleteAll();
			await tx.orm.public.Memory.where({ id, userId: user.id }).delete();
			return MemoryUtils.toMemoryState(memory);
		}),
} as const;
