import type { ChatEvent } from "#core/features/data/types/chat.ts";
import { mockConfig } from "#core/tests.ts";
import { ChatEventService } from "#server/features/chat/services/ChatEventService.ts";
import { ChatService } from "#server/features/chat/services/ChatService.ts";
import { MessageService } from "#server/features/message/services/MessageService.ts";
import { testUser } from "#server/tests.ts";

const user = testUser();
const content = { config: mockConfig(), data: [], metadata: [] };

/** The events heard for `user` while `run` runs. */
const hear = async (run: () => Promise<unknown>) => {
	const heard: ChatEvent[] = [];
	const controller = new AbortController();
	const listening = (async () => {
		try {
			for await (const event of ChatEventService.listen(
				user.id,
				controller.signal,
			))
				heard.push(event);
		} catch {}
	})();
	await run();
	controller.abort();
	await listening;
	return heard;
};

const unread = async (chatId: string) =>
	(await ChatService.getChat({ user, chat: chatId })).unread;

describe("chat unread state", () => {
	it("is read once prompted, unread once answered unseen, and read once opened", async () => {
		let prompt!: Awaited<ReturnType<typeof MessageService.createMessage>>;
		const created = await hear(async () => {
			prompt = await MessageService.createMessage({
				user,
				author: "USER",
				...content,
			});
		});
		expect(created).toContainEqual({ type: "list" });
		expect(await unread(prompt.chatId)).toBe(false);

		const answered = await hear(() =>
			MessageService.createMessage({
				user,
				chat: prompt.chatId,
				previous: prompt.id,
				author: "MODEL",
				origin: "elsewhere",
				...content,
			}),
		);
		expect(answered).toContainEqual({
			type: "chat",
			chatId: prompt.chatId,
			unread: true,
			messages: true,
			origin: "elsewhere",
		});
		expect(await unread(prompt.chatId)).toBe(true);

		const release = await ChatEventService.view(user.id, prompt.chatId);
		expect(await unread(prompt.chatId)).toBe(false);

		// Written while open somewhere, it never reads as unread anywhere.
		const reply = await MessageService.createMessage({
			user,
			chat: prompt.chatId,
			previous: prompt.id,
			author: "MODEL",
			...content,
		});
		expect(await unread(reply.chatId)).toBe(false);
		release();

		await MessageService.updateMessage({
			user,
			message: reply.id,
			author: "MODEL",
			...content,
		});
		expect(await unread(reply.chatId)).toBe(true);
	});
});
