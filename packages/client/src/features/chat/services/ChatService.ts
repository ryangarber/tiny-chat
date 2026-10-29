import { matchQuery } from "@tanstack/react-query";
import type { Client } from "#client/client.ts";
import { useConfigStore } from "#client/features/agent/stores/useConfigStore.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useSeenStore } from "#client/features/chat/stores/useSeenStore.ts";
import type {
	NewChatOptions,
	ProjectRef,
} from "#client/features/chat/types/activeChat.ts";
import { ActiveChatUtils } from "#client/features/chat/utils/ActiveChatUtils.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { AttachmentUtils } from "#client/features/editor/utils/AttachmentUtils.ts";
import { MessageQueryService } from "#client/features/message/services/MessageQueryService.ts";

export const ChatService = {
	/** Leaves the current chat (if any) for a new one in `project`. */
	newChat: (project: ProjectRef | null) => {
		useChatStore.getState().start(project);
	},

	/**
	 * Opens an existing chat, or, with no id, leaves for a new one in the same
	 * project.
	 */
	setChat: ({ id }: { id: string | null }) => {
		const { active, open, start } = useChatStore.getState();
		if (id) open(id);
		else start(active.project);
	},

	/**
	 * Ask about a passage on the side: a fresh chat, in the same project, with
	 * the chat it came from attached and the passage quoted, ready for the
	 * question. The new chat opens at once; the chips follow once the chat has
	 * been read.
	 */
	quoteInNewChat: async ({
		client,
		chatId,
		model,
		text,
	}: {
		client: Client;
		chatId: string;
		model: string;
		text: string;
	}) => {
		ChatService.setChat({ id: null });

		const chat = await client.api.chat.getChat.query(chatId);
		await ComposerService.insertAttachment({
			client,
			item: AttachmentUtils.forChat({ chat }),
		});
		ComposerService.insertQuote({ client, model, text });
	},

	/**
	 * Sets how the next new chat is created, leaving an open chat for one
	 * outside any project first.
	 */
	setNewChatOptions: (options: Partial<NewChatOptions>) => {
		if (useChatStore.getState().active.status === "open")
			ChatService.newChat(null);
		useChatStore.getState().setOptions(options);
	},

	/**
	 * Leaves the current chat (if any) for a new one in the next project, or
	 * the previous one with `direction` -1. The cycle runs none, first, ...,
	 * last, none.
	 */
	cycleProject: (projects: ProjectRef[], direction: 1 | -1 = 1) => {
		if (!projects.length) return;
		const current = useChatStore.getState().active.project;
		const cycle = [null, ...projects];
		const index = cycle.findIndex((other) => other?.id === current?.id);
		ChatService.newChat(
			cycle[(index + direction + cycle.length) % cycle.length],
		);
	},

	/**
	 * Opens the chat a message is in, on the branch that leads to it, and asks
	 * for it to be scrolled to. Selections below it are kept when it is in the chat already open.
	 */
	openMessage: async ({ client, id }: { client: Client; id: string }) => {
		const located = await client.api.message.locateMessage.query({
			message: id,
		});
		const branches = {
			...ActiveChatUtils.branches(
				useChatStore.getState().active,
				located.chatId,
			),
			...located.branches,
		};
		// Loaded before switching, so the chat opens on it instead of filling in.
		await client.queryClient.prefetchQuery(
			MessageQueryService.options(client, located.chatId, branches),
		);
		const { active, open, focusMessage } = useChatStore.getState();
		if (active.chatId !== located.chatId) open(located.chatId);
		focusMessage(id, branches);
	},

	fetchChat: async ({ client, id }: { client: Client; id: string }) => {
		useSeenStore.getState().setLastSeen(id, Date.now());
		await client.queryClient.invalidateQueries({
			queryKey: client.query.chat.getChat.pathKey(),
		});
	},

	fetchChatList: async ({ client }: { client: Client }) => {
		await client.queryClient.invalidateQueries({
			queryKey: client.query.chat.getChatList.pathKey(),
		});
	},

	fetchMessages: async ({
		client,
		chatId,
	}: {
		client: Client;
		chatId: string;
	}) => {
		if (chatId) useSeenStore.getState().setLastSeen(chatId, Date.now());
		await MessageQueryService.invalidate(client, chatId);
	},

	/**
	 * What follows from the active chat changing, wherever it was changed from:
	 * the config follows the chat, an edit or insert in the chat left is
	 * dropped, and the active project follows the open chat once it loads,
	 * including when it is moved to another.
	 */
	watch: ({ client }: { client: Client }) => {
		// Entering an existing chat adopts its last config once its messages load.
		const syncConfig = () => {
			const { syncChatId, setOverrideConfig, setSyncChatId } =
				useConfigStore.getState();
			if (!syncChatId || syncChatId !== useChatStore.getState().active.chatId)
				return;
			const history = MessageQueryService.getCurrent(client, syncChatId);
			if (!history) return;
			const config = MessageQueryService.getLastConfig(history.messages);
			if (config) {
				setOverrideConfig(config);
				client.setStorage("config", config);
			} else {
				setSyncChatId(null);
			}
		};

		const load = () => {
			const { active, load } = useChatStore.getState();
			if (!active.chatId) return;
			const chat = client.queryClient.getQueryData(
				client.query.chat.getChat.queryKey({ id: active.chatId }),
			);
			if (chat) load(chat);
		};

		const unsubscribeChat = useChatStore.subscribe(
			(state) => state.active.chatId,
			(chatId) => {
				// Leaving for a new chat keeps the current config; entering an
				// existing one adopts that chat's.
				useConfigStore.getState().setSyncChatId(chatId);
				ComposerService.cancel({ client });
				load();
			},
		);

		const unsubscribeConfig = useConfigStore.subscribe((state, previous) => {
			if (state.syncChatId !== previous.syncChatId) syncConfig();
		});

		const chatKey = { queryKey: client.query.chat.getChat.pathKey() };
		const messagesKey = {
			queryKey: client.query.message.getMessages.pathKey(),
		};
		const unsubscribeCache = client.queryClient
			.getQueryCache()
			.subscribe((event) => {
				if (event.type !== "added" && event.type !== "updated") return;
				if (matchQuery(chatKey, event.query)) load();
				if (matchQuery(messagesKey, event.query)) syncConfig();
			});

		return () => {
			unsubscribeChat();
			unsubscribeConfig();
			unsubscribeCache();
		};
	},
} as const;
