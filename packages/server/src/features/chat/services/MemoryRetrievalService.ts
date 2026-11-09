import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	MemorySearchResult,
	MemorySource,
	MemoryState,
} from "#core/features/data/types/memory.ts";
import type { MessageLike } from "#core/features/data/types/message.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { createEmbeddingCapability } from "#server/core/capabilities/createEmbeddingCapability.ts";
import { MemorySearchService } from "#server/features/chat/services/MemorySearchService.ts";
import { EmbeddingService } from "#server/features/embedding/services/EmbeddingService.ts";

const MEMORY_BOILERPLATE = `<memory id="" category="" stability="" learned="">\n\n</memory>`;

export const MemoryRetrievalService = {
	withinBudget: <
		T extends Pick<
			MemoryState,
			"fact" | "category" | "stability" | "createdAt"
		>,
	>(
		memories: T[],
		tokens: number,
	): T[] => {
		let remaining = tokens * 3;
		return memories.filter((memory) => {
			const size =
				MEMORY_BOILERPLATE.length +
				memory.fact.length +
				memory.category.length +
				memory.stability.length +
				CommonUtils.formatDate({ date: memory.createdAt, relative: true })
					.length;
			if (size > remaining) return false;
			remaining -= size;
			return true;
		});
	},

	embed: async ({
		user,
		text,
		message,
	}: {
		user: zUser;
		text: string;
		message?: MessageLike;
	}) => {
		const stored = await EmbeddingService.getMessageEmbedding({
			user,
			message,
		});
		if (stored) return stored;

		if (!text.trim() || !user.settings.embeddingConfig) return undefined;

		try {
			const capability = await createEmbeddingCapability({ user });
			const embedding = await capability.runEmbedding({ text });

			if (message) {
				const id = typeof message === "string" ? message : message.id;
				await globalThis.db.orm.public.Message.where({
					id,
					userId: user.id,
				})
					.where((message) => message.embedding.isNull())
					.updateAndCount({ embedding });
			}

			return embedding;
		} catch (error) {
			console.warn(
				"[MemoryRetrievalService] embedding unavailable; using lexical retrieval",
				error,
			);
			return undefined;
		}
	},

	build: async ({
		user,
		text,
		message,
		tokens,
		embed = true,
		more,
	}: {
		user: zUser;
		text: string;
		message?: MessageLike;
		tokens: number;
		embed?: boolean;
		more: boolean;
	}): Promise<{ memories: MemorySearchResult[]; embedding?: number[] }> => {
		if (tokens <= 0) return { memories: [] };

		const embedding =
			embed && text.trim()
				? await MemoryRetrievalService.embed({
						user,
						text,
						message,
					})
				: undefined;

		const memories = await MemorySearchService.searchMemories({
			user,
			searchText: text,
			searchEmbedding: embedding,
			limit: more ? 300 : 100,
			minConfidence: more ? 0 : 0.5,
			tokens,
		});

		return {
			memories: MemoryRetrievalService.withinBudget(memories, tokens),
			embedding,
		};
	},

	retrieve: async ({
		user,
		messages,
		tokens,
	}: {
		user: zUser;
		messages: MemorySource[];
		tokens: number;
	}): Promise<MemorySearchResult[][]> => {
		if (tokens <= 0) return messages.map(() => []);

		const result: MemorySearchResult[][] = [];

		console.log(
			">> messages",
			messages.map((m) => ({
				text: "text" in m ? m.text : undefined,
				id: "id" in m ? m.id : undefined,
			})),
		);

		for (const source of messages) {
			if ("text" in source) {
				const { memories } = await MemoryRetrievalService.build({
					user,
					text: source.text.trim().length > 0 ? source.text : "a",
					tokens,
					embed: false,
					more: true,
				});

				console.log(
					">> from text",
					{ text: source.text },
					memories.map((m) => ({ id: m.id, fact: m.fact })),
				);
				result.push(memories);
				continue;
			}

			const message = await globalThis.db.orm.public.Message.where({
				id: source.id,
				userId: user.id,
				author: "USER",
			})
				.include("context", (memory) =>
					memory.select(
						"id",
						"fact",
						"category",
						"stability",
						"evidence",
						"confidence",
						"createdAt",
						"updatedAt",
					),
				)
				.first();

			console.log(
				">> from message",
				{
					text: "text" in source ? source.text : undefined,
					id: "id" in source ? source.id : undefined,
				},
				message?.context.map((m) => ({ id: m.id, fact: m.fact })),
			);

			if (!message) {
				result.push([]);
				continue;
			}

			result.push(MemoryRetrievalService.withinBudget(message.context, tokens));
		}

		const seen = new Set<string>();
		console.log(">> result", result);
		return result.map((memories) =>
			memories.filter((memory) => {
				if (seen.has(memory.id)) return false;
				seen.add(memory.id);
				return true;
			}),
		);
	},
} as const;
