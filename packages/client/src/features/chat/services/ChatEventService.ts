import type { InfiniteData } from "@tanstack/react-query";
import type { Client } from "#client/client.ts";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { MessageQueryService } from "#client/features/message/services/MessageQueryService.ts";
import type {
	ChatEvent,
	ChatState,
	ProjectState,
} from "#core/features/data/types/chat.ts";

type ChatListPage = {
	projects: ProjectState[];
	chats: ChatState[];
	nextCursor: string | null;
};

/** How long a burst of changes is gathered before they are read again. */
const SETTLE_MS = 300;

/** Calls `run` once things have been quiet for `ms`, but at least every `ms * 4`. */
const settle = (run: () => void, ms = SETTLE_MS) => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let first: number | undefined;
	return () => {
		first ??= Date.now();
		clearTimeout(timer);
		timer = setTimeout(
			() => {
				first = undefined;
				run();
			},
			Math.max(0, Math.min(ms, first + ms * 4 - Date.now())),
		);
	};
};

/** Sets whether a chat is unread wherever it is cached. */
const setUnread = (client: Client, chatId: string, unread: boolean) => {
	const patch = (chat: ChatState) => {
		if (chat.id !== chatId) return chat;
		return chat.unread === unread ? chat : { ...chat, unread };
	};
	client.queryClient.setQueriesData<InfiniteData<ChatListPage>>(
		{ queryKey: client.query.chat.getChatList.pathKey() },
		(data) =>
			data && {
				...data,
				pages: data.pages.map((page) => ({
					...page,
					chats: page.chats.map(patch),
					projects: page.projects.map((project) => ({
						...project,
						chats: project.chats.map(patch),
					})),
				})),
			},
	);
	client.queryClient.setQueryData(
		client.query.chat.getChat.queryKey({ id: chatId }),
		(chat) => chat && patch(chat),
	);
};

/**
 * Keeps this instance's chats up to date with what happens to them anywhere:
 * the list follows chats being added, renamed, moved, and removed, each chat
 * is marked unread when written to while nobody has it open, and the open
 * chat takes in messages written to it elsewhere.
 */
export const ChatEventService = {
	/**
	 * Listens for as long as the client runs, telling the server which chat is
	 * open by listening anew whenever that changes. Returns a restart, for when
	 * the session it listens with changes, and a stop.
	 */
	watch: ({ client, instance }: { client: Client; instance: string }) => {
		const refetchList = settle(() => {
			void client.queryClient.invalidateQueries({
				queryKey: client.query.chat.getChatList.pathKey(),
			});
			void client.queryClient.invalidateQueries({
				queryKey: client.query.chat.getChat.pathKey(),
			});
		});

		// The open chat is read again once writes to it from elsewhere settle,
		// unless this instance is generating in it, writing it itself.
		const refetchOpen = settle(() => {
			const { chatId } = useChatStore.getState().active;
			if (!chatId || useStreamStore.getState().chatAgentStreams.has(chatId))
				return;
			void MessageQueryService.invalidate(client, chatId);
		}, 1000);

		const onEvent = (event: ChatEvent) => {
			if (event.type === "list") return refetchList();
			const open = useChatStore.getState().active.chatId === event.chatId;
			// The open chat is read here, whatever the server last heard. One the
			// list doesn't hold is left for it to read when it gets there: adding
			// a chat says so on its own.
			setUnread(client, event.chatId, event.unread && !open);
			if (open && event.messages && event.origin !== instance) refetchOpen();
		};

		let subscription: { unsubscribe: () => void } | undefined;
		const listen = () => {
			subscription?.unsubscribe();
			const viewing = useChatStore.getState().active.chatId;
			if (viewing) setUnread(client, viewing, false);
			let started = false;
			subscription = client.api.chat.onEvent.subscribe(
				{ viewing },
				{
					// Changes missed while reconnecting are only had by reading
					// everything again.
					onStarted: () => {
						if (started) refetchList();
						started = true;
					},
					onData: onEvent,
					onError: (error) =>
						console.warn("[ChatEventService] stopped listening:", error),
				},
			);
		};

		const unsubscribeChat = useChatStore.subscribe(
			(state) => state.active.chatId,
			listen,
		);
		listen();

		return {
			restart: listen,
			stop: () => {
				unsubscribeChat();
				subscription?.unsubscribe();
				subscription = undefined;
			},
		};
	},
} as const;
