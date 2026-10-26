import { mockConfig } from "#core/tests.ts";
import { ChatService } from "#server/features/chat/services/ChatService.ts";
import { MessageService } from "#server/features/message/services/MessageService.ts";
import { testUser } from "#server/tests.ts";

const user = testUser();
const stranger = testUser();
const content = {
	author: "USER" as const,
	config: mockConfig(),
	data: [],
	metadata: [],
};

describe("chat ownership and project lifecycle", () => {
	it("refuses cross-user reads and moves, and leaves both owners' data untouched", async () => {
		const message = await MessageService.createMessage({ user, ...content });
		const foreignProject = await ChatService.createProject({ user: stranger });
		await expect(
			ChatService.getChat({ user: stranger, chat: message.chatId }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			ChatService.setChatTitle({
				user: stranger,
				chat: message.chatId,
				title: "hijacked",
			}),
		).rejects.toThrow();
		await expect(
			ChatService.setChatProject({
				user,
				chat: message.chatId,
				projectId: foreignProject.id,
			}),
		).rejects.toThrow();
		await ChatService.deleteChat({ user: stranger, chat: message.chatId });
		const chat = await ChatService.getChat({ user, chat: message.chatId });
		expect(chat.projectId).toBeNull();
		expect(chat.title).not.toBe("hijacked");
	});

	it("deleting one chat preserves its project and the other chats in it", async () => {
		const project = await ChatService.createProject({ user });
		const first = await MessageService.createMessage({
			user,
			...content,
			projectId: project.id,
		});
		const second = await MessageService.createMessage({
			user,
			...content,
			projectId: project.id,
		});
		await ChatService.deleteChat({ user, chat: first.chatId });
		await ChatService.deleteChat({ user, chat: first.chatId });
		await expect(
			ChatService.getChat({ user, chat: first.chatId }),
		).rejects.toThrow();
		expect(
			(await ChatService.getChat({ user, chat: second.chatId })).projectId,
		).toBe(project.id);
		const list = await ChatService.getChats({ user });
		expect(
			list.projects.find((p) => p.id === project.id)?.chats.map((c) => c.id),
		).toEqual([second.chatId]);
	});

	it("can remove a project while keeping its chats, or delete them with it", async () => {
		for (const deleteChats of [false, true]) {
			const project = await ChatService.createProject({ user });
			const message = await MessageService.createMessage({
				user,
				...content,
				projectId: project.id,
			});
			await ChatService.deleteProject({
				user,
				project: project.id,
				deleteChats,
			});
			if (deleteChats)
				await expect(
					ChatService.getChat({ user, chat: message.chatId }),
				).rejects.toThrow();
			else
				expect(
					(await ChatService.getChat({ user, chat: message.chatId })).projectId,
				).toBeNull();
			expect(
				(await ChatService.getChats({ user })).projects.some(
					(p) => p.id === project.id,
				),
			).toBe(false);
		}
	});

	it("paginates standalone chats without gaps and omits temporary and project chats", async () => {
		// Use this user's existing chats as well: pagination must cover the entire list.
		await MessageService.createMessage({ user, ...content });
		await MessageService.createMessage({ user, ...content });
		const temporary = await MessageService.createMessage({
			user,
			...content,
			temporary: true,
		});
		const whole = await ChatService.getChats({ user });
		expect(whole.chats.some((c) => c.id === temporary.chatId)).toBe(false);
		expect(whole.chats.every((c) => !c.projectId)).toBe(true);
		const seen: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await ChatService.getChats({ user, limit: 1, cursor });
			if (cursor) expect(page.projects).toEqual([]);
			seen.push(...page.chats.map((c) => c.id));
			cursor = page.nextCursor ?? undefined;
			expect(seen.length).toBeLessThanOrEqual(whole.chats.length);
		} while (cursor);
		expect(seen).toEqual(whole.chats.map((c) => c.id));
	});
});
