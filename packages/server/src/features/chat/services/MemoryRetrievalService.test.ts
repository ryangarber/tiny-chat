import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import { AgentMessagesService } from "#core/features/agent/services/AgentMessagesService.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import { createMemoriesCapability } from "#server/core/capabilities/createMemoriesCapability.ts";
import { db } from "#server/db.ts";
import { ChatService } from "#server/features/chat/services/ChatService.ts";
import { MemoryRetrievalService } from "#server/features/chat/services/MemoryRetrievalService.ts";
import { MemorySearchService } from "#server/features/chat/services/MemorySearchService.ts";
import { MemoryService } from "#server/features/chat/services/MemoryService.ts";
import { EmbeddingService } from "#server/features/embedding/services/EmbeddingService.ts";
import { MessageService } from "#server/features/message/services/MessageService.ts";
import { testUser } from "#server/tests.ts";

const user = testUser();
const other = testUser();
const content = {
	author: "USER" as const,
	config: zConfig.parse({ provider: "test", model: "test-generate" }),
	data: [
		[
			{
				id: CommonUtils.getRandomId(),
				type: "text" as const,
				value: "orchids greenhouse",
			},
		],
	],
	metadata: [],
};
const fact = {
	fact: "The user grows orchids in a greenhouse.",
	category: "PROJECTS" as const,
	stability: "LONG_TERM" as const,
	evidence: ["user statement"],
	confidence: 0.9,
};

const tokens = SettingsUtils.defaults().memoryBudget;

describe("MemoryRetrievalService", () => {
	it("selects memories once at message creation, isolates users, and supports incognito", async () => {
		const memory = await MemoryService.createMemory({ user, ...fact });
		await MemoryService.createMemory({ user: other, ...fact });

		const message = await MessageService.createMessage({ user, ...content });
		expect(
			(
				await MemoryRetrievalService.retrieve({
					user,
					messages: [message],
					tokens,
				})
			).map((m) => m.map((c) => c.id)),
		).toEqual([[memory.id]]);

		const later = await MemoryService.createMemory({
			user,
			...fact,
			fact: "Orchids need the user's automated greenhouse irrigation.",
		});

		const next = await MessageService.createMessage({
			user,
			...content,
			chat: message.chatId,
		});

		expect(
			(
				await MemoryRetrievalService.retrieve({
					user,
					messages: [message, next],
					tokens,
				})
			).map((m) => m.map((c) => c.id)),
		).toEqual([[memory.id], [later.id]]);

		expect(
			await MemoryRetrievalService.retrieve({
				user: other,
				messages: [message],
				tokens,
			}),
		).toEqual([[]]);

		const hidden = await MessageService.createMessage({
			user,
			...content,
			incognito: true,
		});

		expect(
			await MemoryRetrievalService.retrieve({
				user,
				messages: [hidden],
				tokens,
			}),
		).toEqual([[]]);

		await MemoryService.deleteMemory({ user, id: memory.id });

		expect(
			await MemoryRetrievalService.retrieve({
				user,
				messages: [message],
				tokens,
			}),
		).toEqual([[]]);

		await MemoryService.updateMemory({
			user,
			id: later.id,
			...fact,
			fact: "The user now studies astronomy.",
		});

		expect(
			(
				await MemorySearchService.searchMemories({
					user,
					searchText: "astronomy",
				})
			).map((m) => m.id),
		).toContain(later.id);
	});

	it("honors a project's zero budget on creation, continuation, edits, sources, and prompts", async () => {
		await MemoryService.createMemory({ user, ...fact });
		const project = await db.orm.public.Project.create({
			id: CommonUtils.getRandomId(),
			userId: user.id,
			title: "No automatic memories",
			settings: { memoryBudget: 0 },
		});
		expect(SettingsUtils.of(user, project).memoryBudget).toBe(0);
		expect(SettingsUtils.of(user).memoryBudget).toBe(2500);
		const first = await MessageService.createMessage({
			user,
			...content,
			projectId: project.id,
		});
		const next = await MessageService.createMessage({
			user,
			...content,
			chat: first.chatId,
		});
		const edited = await MessageService.editMessage({
			user,
			...content,
			message: next,
			truncate: true,
		});
		for (const message of [first, next, edited]) {
			expect(
				await db.orm.public.MessageContext.where({
					messageId: message.id,
				}).all(),
			).toEqual([]);
		}
		expect(
			await MemoryService.getChatMemoryIds({ user, chat: first.chatId }),
		).toEqual([]);

		// Old links can survive a budget change or the former creation bug.
		const memory = await MemoryService.createMemory({ user, ...fact });
		await db.orm.public.MessageContext.create({
			messageId: first.id,
			memoryId: memory.id,
		});
		expect(
			await MemoryRetrievalService.retrieve({
				user,
				messages: [first, next],
				tokens: 0,
			}),
		).toEqual([[], []]);
		expect(
			await MemoryRetrievalService.retrieve({
				user,
				messages: [{ text: "orchids" }],
				tokens: 0,
			}),
		).toEqual([[]]);
		expect(
			await MemoryService.getChatMemoryIds({ user, chat: first.chatId }),
		).toEqual([]);

		const { messages } = await AgentMessagesService.buildMessages({
			context: {
				user,
				chat: { id: first.chatId, project, incognito: false, temporary: false },
				messages: [first, next],
				timezone: "UTC",
				interactive: true,
			},
			capabilities: {
				memories: await createMemoriesCapability({ user }),
			},
		});
		expect(JSON.stringify(messages)).not.toContain("<memory ");

		// Learning a memory is distinct from injecting an automatic reminder.
		const learned = await MemoryService.createMemory({
			user,
			message: first,
			...fact,
		});
		expect(
			await MemoryService.getChatMemoryIds({ user, chat: first.chatId }),
		).toEqual([learned.id]);
	});

	it("uses an existing incognito chat's privacy flag when callers omit it", async () => {
		await MemoryService.createMemory({ user, ...fact });
		const first = await MessageService.createMessage({
			user,
			...content,
			incognito: true,
		});
		const next = await MessageService.createMessage({
			user,
			...content,
			chat: first.chatId,
		});
		expect(
			await db.orm.public.MessageContext.where({ messageId: next.id }).all(),
		).toEqual([]);
	});

	it("allows deleting a chat and its last message after memories were attached", async () => {
		await MemoryService.createMemory({ user, ...fact });
		const chat = await MessageService.createMessage({ user, ...content });
		await ChatService.deleteChat({ user, chat: chat.chatId });
		expect(
			await db.orm.public.MessageContext.where((link) =>
				link.messageId.eq(chat.id),
			).all(),
		).toEqual([]);
		const message = await MessageService.createMessage({ user, ...content });
		expect(await MessageService.deleteMessage({ user, message })).toBe(true);
		expect(
			await db.orm.public.MessageContext.where({ messageId: message.id }).all(),
		).toEqual([]);
	});

	it("reuses a stored raw vector and does not retrieve unrelated vectors when no query vector exists", async () => {
		const message = await MessageService.createMessage({ user, ...content });
		const vector = [1, 0, 0];
		await db.orm.public.Message.where({ id: message.id }).updateAndCount({
			embedding: vector,
		});
		expect(
			await EmbeddingService.getMessageEmbedding({ user, message }),
		).toEqual(vector);
		expect(
			await MemoryRetrievalService.embed({ user, message, text: "orchids" }),
		).toEqual(vector);
		expect(
			await EmbeddingService.getMessageEmbedding({ user: other, message }),
		).toBeNull();
		const memory = await MemoryService.createMemory({
			user,
			...fact,
			fact: "Sailing is a recurring hobby.",
		});
		await db.orm.public.Memory.where({ id: memory.id }).updateAndCount({
			embedding: vector,
		});
		expect(
			await MemorySearchService.searchMemories({
				user,
				searchText: "unmatchedword",
			}),
		).toEqual([]);
		expect(
			(
				await MemorySearchService.searchMemories({
					user,
					searchText: "unmatchedword",
					searchEmbedding: vector,
				})
			).map((m) => m.id),
		).toContain(memory.id);
	});

	it("bounds a collection larger than the former soft limit and gives dreams more context", () => {
		const memories = Array.from(
			{ length: 300 },
			(_) =>
				({
					fact: "orchids ".repeat(100),
					category: "IDENTITY",
					stability: "LONG_TERM",
					createdAt: Temporal.Now.plainDateTimeISO("UTC"),
				}) satisfies Parameters<
					typeof MemoryRetrievalService.withinBudget
				>[0][number],
		);
		const normal = MemoryRetrievalService.withinBudget(memories, tokens);
		const dream = MemoryRetrievalService.withinBudget(memories, 12_000);
		expect(dream.length).toBeGreaterThan(normal.length);
		expect(dream.length).toBeLessThan(memories.length);
		expect(
			normal.reduce(
				(n, m) =>
					n +
					m.fact.length +
					m.category.length +
					m.stability.length +
					"1 month ago".length +
					"<memory />".length,
				0,
			),
		).toBeLessThanOrEqual(tokens * 3);
	});
});
