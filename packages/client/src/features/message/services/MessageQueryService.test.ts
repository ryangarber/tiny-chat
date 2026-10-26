import type { Client } from "#client/client.ts";
import { useConfigStore } from "#client/features/agent/stores/useConfigStore.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { MessageQueryService } from "#client/features/message/services/MessageQueryService.ts";
import { create, onAfterAll, onBeforeAll } from "#client/tests.ts";
import { zClientEnv } from "#core/core/types/env.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";
import { mockConfig } from "#core/tests.ts";

let client: Client;
let input: zData = [];
const content = {
	author: "USER" as const,
	config: mockConfig(),
	data: [],
	metadata: [],
};
let root: MessageState;
let a: MessageState;
let b: MessageState;
let leaf: MessageState;
const ids = () =>
	MessageQueryService.getCurrent(client, root.chatId)?.messages.map(
		(m) => m.id,
	);

beforeAll(async () => {
	await onBeforeAll({
		env: zClientEnv.parse(process.env),
		input: {
			getData: () => input,
			getText: () => "draft",
			setData: ({ data }) => {
				input = data;
			},
			insertNode: () => {
				throw new Error("unused");
			},
		},
	});
	client = create(null).client;
	// Service tests retain histories as mounted chat queries do in the UI.
	client.queryClient.setDefaultOptions({
		queries: { retry: false, gcTime: Infinity },
		mutations: { retry: false, gcTime: 0 },
	});
	const signedIn = await client.auth.signIn.anonymous();
	if (!signedIn.data?.token) throw new Error("anonymous sign-in failed");
	client.setToken(signedIn.data.token);
});

beforeEach(async () => {
	useChatStore.getState().start(null);
	await client.workingDirectory.ready();
	client.queryClient.clear();
	root = await client.api.message.createMessage.mutate(content);
	a = await client.api.message.createMessage.mutate({
		...content,
		chat: root.chatId,
		previous: root.id,
	});
	b = await client.api.message.createMessage.mutate({
		...content,
		chat: root.chatId,
		previous: root.id,
	});
	leaf = await client.api.message.createMessage.mutate({
		...content,
		chat: root.chatId,
		previous: b.id,
	});
	useChatStore.getState().open(root.chatId);
	await client.workingDirectory.ready();
	await MessageQueryService.ensure(client, root.chatId, {});
});

afterEach(async () => {
	ComposerService.reset({ client });
	useChatStore.getState().start(null);
	await client.workingDirectory.ready();
	await client.api.chat.deleteChat.mutate(root.chatId);
});

afterAll(async () => {
	client.workingDirectory.dispose();
	await onAfterAll();
});

describe("MessageQueryService with persisted branches", () => {
	it("switches only the suffix and keeps the shared prefix object", async () => {
		const prefix = MessageQueryService.getCurrent(client, root.chatId)
			?.messages[0];
		expect(ids()).toEqual([root.id, a.id]);
		await MessageQueryService.selectBranch(client, root.id, b.id);
		expect(ids()).toEqual([root.id, b.id, leaf.id]);
		expect(
			MessageQueryService.getCurrent(client, root.chatId)?.messages[0],
		).toBe(prefix);
		expect(
			MessageQueryService.getCurrent(client, root.chatId)?.branchOptions[b.id],
		).toEqual([a.id, b.id]);
		await MessageQueryService.selectBranch(client, root.id, a.id);
		expect(ids()).toEqual([root.id, a.id]);
	});

	it("replaces cached content on every branch while keeping an invalidated history stale", async () => {
		await MessageQueryService.selectBranch(client, root.id, b.id);
		const oldOptions = MessageQueryService.options(client, root.chatId, {});
		await client.queryClient.invalidateQueries({
			queryKey: oldOptions.queryKey,
			exact: true,
			refetchType: "none",
		});
		const updated = await client.api.message.updateMessage.mutate({
			...content,
			message: root.id,
			data: [[{ id: crypto.randomUUID(), type: "text", value: "updated" }]],
		});
		await MessageQueryService.write(client, updated);
		for (const branches of [{}, { [root.id]: b.id }]) {
			const history = client.queryClient.getQueryData(
				MessageQueryService.options(client, root.chatId, branches).queryKey,
			);
			expect(history?.messages[0].data).toEqual(updated.data);
		}
		expect(
			client.queryClient.getQueryState(oldOptions.queryKey)?.isInvalidated,
		).toBe(true);
	});

	it("selects a new sibling, truncates the selected suffix, and preserves the original branch", async () => {
		const sibling = await client.api.message.createMessage.mutate({
			...content,
			chat: root.chatId,
			previous: root.id,
		});
		await MessageQueryService.write(client, sibling, true);
		expect(ids()).toEqual([root.id, sibling.id]);
		expect(
			MessageQueryService.getCurrent(client, root.chatId)?.branchOptions[
				sibling.id
			],
		).toEqual([a.id, b.id, sibling.id]);
		await MessageQueryService.selectBranch(client, root.id, b.id);
		expect(ids()).toEqual([root.id, b.id, leaf.id]);
	});

	it("appends a saved descendant without refetching away the existing prefix", async () => {
		const prefix = MessageQueryService.getCurrent(
			client,
			root.chatId,
		)?.messages;
		const child = await client.api.message.createMessage.mutate({
			...content,
			chat: root.chatId,
			previous: a.id,
		});
		await MessageQueryService.write(client, child, true);
		expect(ids()).toEqual([root.id, a.id, child.id]);
		expect(
			MessageQueryService.getCurrent(client, root.chatId)?.messages[0],
		).toBe(prefix?.[0]);
	});

	it("waits for a pending history read before installing newer saved content", async () => {
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const options = MessageQueryService.options(client, root.chatId, {});
		const pending = client.queryClient.fetchQuery({
			...options,
			staleTime: 0,
			queryFn: async () => {
				const history = await client.api.message.getMessages.query({
					chat: root.chatId,
				});
				started.resolve();
				await gate.promise;
				return history;
			},
		});
		await started.promise;
		try {
			const updated = await client.api.message.updateMessage.mutate({
				...content,
				message: a.id,
				data: [
					[
						{
							id: crypto.randomUUID(),
							type: "text",
							value: "saved after read",
						},
					],
				],
			});
			let settled = false;
			const write = MessageQueryService.write(client, updated).then(() => {
				settled = true;
			});
			await Promise.resolve();
			expect(settled).toBe(false);
			gate.resolve();
			await Promise.all([pending, write]);
			expect(
				MessageQueryService.getCurrent(client, root.chatId)?.messages[1].data,
			).toEqual(updated.data);
		} finally {
			gate.resolve();
			await pending;
		}
	});

	it("does not switch the user's chat when another chat finishes saving", async () => {
		useChatStore.getState().start(null);
		await client.workingDirectory.ready().catch(() => {});
		await MessageQueryService.write(client, a, true);
		expect(useChatStore.getState().active).toMatchObject({
			status: "new",
			project: null,
		});
	});

	it("opens a located message on its branch and keeps deeper choices in the same chat", async () => {
		await ChatService.openMessage({ client, id: leaf.id });
		expect(ids()).toEqual([root.id, b.id, leaf.id]);
		expect(useChatStore.getState().active).toMatchObject({
			focusedMessage: leaf.id,
			branches: { [root.id]: b.id },
		});
		await ChatService.openMessage({ client, id: root.id });
		expect(ids()).toEqual([root.id, b.id, leaf.id]);
	});
});

describe("shared composer and chat transitions", () => {
	it("cancels an edit on leaving a chat and schedules the destination config", () => {
		ComposerService.edit({ client, message: a });
		expect(useComposerStore.getState().mode.kind).toBe("edit");
		ChatService.setChat({ id: null });
		expect(useComposerStore.getState().mode.kind).toBe("write");
		expect(input).toEqual([]);
		expect(useConfigStore.getState().syncChatId).toBeNull();
	});

	it("keeps the draft when cancelling an insertion and clears it after sending", () => {
		ComposerService.insertAfter({ client, message: root });
		const data: zData = [
			[{ id: crypto.randomUUID(), type: "text", value: "draft" }],
		];
		ComposerService.setData({ client, data });
		ComposerService.cancel({ client });
		expect(input).toEqual(data);
		ComposerService.reset({ client });
		expect(input).toEqual([]);
		expect(useComposerStore.getState().isEmpty).toBe(true);
	});

	it("follows cached chat placement when moved and preserves its project on leaving", async () => {
		const key = client.query.chat.getChat.queryKey({ id: root.chatId });
		const project = await client.api.chat.createProject.mutate();
		const chat = {
			...(await client.api.chat.getChat.query(root.chatId)),
			projectId: project.id,
			project: { title: "Moved", settings: {} },
		};
		// The watcher only reads placement from this entry; use the real chat shape.
		client.queryClient.setQueryData(key, chat);
		expect(useChatStore.getState().active.project).toEqual({
			id: project.id,
			title: "Moved",
		});
		ChatService.setChat({ id: null });
		expect(useChatStore.getState().active).toMatchObject({
			status: "new",
			project: { id: project.id },
		});
		await client.workingDirectory.ready();
		useChatStore.getState().start(null);
		await client.workingDirectory.ready();
		await client.api.chat.deleteProject.mutate({
			project: project.id,
			deleteChats: false,
		});
	});
});
