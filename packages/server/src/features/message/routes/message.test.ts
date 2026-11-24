import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { mockConfig } from "#core/tests.ts";
import { testClient } from "#server/tests.ts";

describe("message", () => {
	const { api } = testClient();

	it("keeps new chats folderless and preserves manually created empty folders", async () => {
		const content = {
			author: "USER" as const,
			config: mockConfig(),
			data: [],
			metadata: [],
		};
		const project = await api.chat.createProject.mutate();
		expect(project.title).toBeNull();
		expect(
			(await api.chat.getChatList.query()).projects.find(
				(item) => item.id === project.id,
			)?.chats,
		).toEqual([]);
		const recent = await api.message.createMessage.mutate(content);
		expect((await api.chat.getChat.query(recent)).projectId).toBeNull();
		const nested = await api.message.createMessage.mutate({
			...content,
			projectId: project.id,
		});
		expect((await api.chat.getChat.query(nested)).projectId).toBe(project.id);
		const list = await api.chat.getChatList.query();
		expect(list.chats.some((item) => item.id === recent.chatId)).toBe(true);
		expect(list.chats.some((item) => item.id === nested.chatId)).toBe(false);
		expect(
			list.projects
				.find((item) => item.id === project.id)
				?.chats.map((item) => item.id),
		).toEqual([nested.chatId]);
		await api.message.deleteMessage.mutate(nested);
		expect(
			(await api.chat.getChatList.query()).projects.find(
				(item) => item.id === project.id,
			)?.chats,
		).toEqual([]);
		await expect(
			api.message.createMessage.mutate({
				...content,
				projectId: CommonUtils.getRandomId(),
			}),
		).rejects.toThrow();
		await api.chat.deleteChat.mutate({ id: recent.chatId });
	});

	it("moves chats into folders and back to recents", async () => {
		const project = await api.chat.createProject.mutate();
		const message = await api.message.createMessage.mutate({
			author: "USER",
			config: mockConfig(),
			data: [],
			metadata: [],
		});

		await api.chat.setChatProject.mutate({
			chat: message.chatId,
			projectId: project.id,
		});

		let list = await api.chat.getChatList.query();
		expect(list.chats.some((chat) => chat.id === message.chatId)).toBe(false);
		expect(
			list.projects
				.find((item) => item.id === project.id)
				?.chats.some((chat) => chat.id === message.chatId),
		).toBe(true);

		await api.chat.setChatProject.mutate({
			chat: message.chatId,
			projectId: null,
		});
		list = await api.chat.getChatList.query();
		expect(list.chats.some((chat) => chat.id === message.chatId)).toBe(true);
		expect(
			list.projects
				.find((item) => item.id === project.id)
				?.chats.some((chat) => chat.id === message.chatId),
		).toBe(false);

		await expect(
			api.chat.setChatProject.mutate({
				chat: message.chatId,
				projectId: CommonUtils.getRandomId(),
			}),
		).rejects.toThrow();
		await api.chat.deleteChat.mutate({ id: message.chatId });
		await api.chat.deleteProject.mutate({ project, deleteChats: false });
	});

	it("creates a new chat with two messages", async () => {
		const first = await api.message.createMessage.mutate({
			author: "USER",
			config: mockConfig(),
			data: [
				[
					{
						id: CommonUtils.getRandomId(),
						type: "text",
						value: "First message",
					},
				],
			],
			metadata: [],
		});

		const second = await api.message.createMessage.mutate({
			chat: first.chatId,
			author: "MODEL",
			config: mockConfig(),
			data: [
				[
					{
						id: CommonUtils.getRandomId(),
						type: "text",
						value: "Reply from model",
					},
				],
			],
			metadata: [],
		});

		const chat = await api.chat.getChat.query(first);
		expect(chat).not.toBeNull();
		expect(second.chatId).toBe(first.chatId);
	});

	it("edits onto a new branch without deleting the original", async () => {
		const first = await api.message.createMessage.mutate({
			author: "USER",
			config: mockConfig(),
			data: [
				[
					{
						id: CommonUtils.getRandomId(),
						type: "text",
						value: "User message",
					},
				],
			],
			metadata: [],
		});

		await api.message.createMessage.mutate({
			chat: first.chatId,
			author: "MODEL",
			config: mockConfig(),
			data: [
				[{ id: CommonUtils.getRandomId(), type: "text", value: "Model reply" }],
			],
			metadata: [],
		});

		const edited = await api.message.editMessage.mutate({
			message: first.id,
			author: "USER",
			config: mockConfig(),
			data: [
				[
					{
						id: CommonUtils.getRandomId(),
						type: "text",
						value: "Edited user message",
					},
				],
			],
			metadata: [],
			truncate: true,
		});

		const { messages } = await api.message.getMessages.query({
			chat: first.chatId,
			start: edited.id,
		});
		expect(messages).toHaveLength(1);
		expect(edited.id).not.toBe(first.id);
		expect(
			(
				await api.message.getMessages.query({
					chat: first.chatId,
					branches: { "": first.id },
				})
			).messages,
		).toHaveLength(2);
	});

	it("deletes the last message which deletes the chat", async () => {
		const first = await api.message.createMessage.mutate({
			author: "USER",
			config: mockConfig(),
			data: [
				[
					{
						id: CommonUtils.getRandomId(),
						type: "text",
						value: "User message",
					},
				],
			],
			metadata: [],
		});

		await api.message.createMessage.mutate({
			chat: first.chatId,
			author: "MODEL",
			config: mockConfig(),
			data: [
				[{ id: CommonUtils.getRandomId(), type: "text", value: "Model reply" }],
			],
			metadata: [],
		});

		await api.message.deleteMessage.mutate({
			id: first.id,
		});

		const chat = await api.chat.getChatList.query();
		expect(
			[
				...chat.chats,
				...chat.projects.flatMap((project) => project.chats),
			].filter((chat) => chat.id === first.chatId),
		).toHaveLength(0);
	});

	it("returns empty array for unknown chatId", async () => {
		const { messages } = await api.message.getMessages.query({ chat: null });
		expect(messages).toEqual([]);
	});
});
