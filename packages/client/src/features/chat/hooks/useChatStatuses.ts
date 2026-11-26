import { useMemo } from "react";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";
import { useToolFeedbackStore } from "#client/features/part/stores/useToolFeedbackStore.ts";
import type { ChatState } from "#core/features/data/types/chat.ts";

/**
 * What a chat shows beside its title: its reply generating here, or waiting
 * on the user to answer one of its calls, whether its generation is still
 * live or has stopped to; failing those, whether anything has happened in it
 * since it was last caught up on, here or elsewhere.
 */
export type ChatStatus = "generating" | "waiting" | "unread";

type StatusChat = Pick<ChatState, "id" | "unread">;

/** The status of one chat, if it has one. */
export const useChatStatus = (chat: StatusChat): ChatStatus | undefined => {
	const generating = useStreamStore((state) =>
		state.chatAgentStreams.has(chat.id),
	);
	const paused = useMessageQueueStore((state) => !!state.paused[chat.id]);
	const awaiting = useToolFeedbackStore((state) =>
		[...state.awaiting.values()].includes(chat.id),
	);
	if (awaiting || (paused && !generating)) return "waiting";
	if (generating) return "generating";
	return chat.unread ? "unread" : undefined;
};

/** The status of each of `chats` that has one, by chat. */
export const useChatStatuses = (
	chats: StatusChat[],
): Record<string, ChatStatus> => {
	const streams = useStreamStore((state) => state.chatAgentStreams);
	const paused = useMessageQueueStore((state) => state.paused);
	const awaiting = useToolFeedbackStore((state) => state.awaiting);

	return useMemo(() => {
		const statuses: Record<string, ChatStatus> = {};
		for (const chat of chats) if (chat.unread) statuses[chat.id] = "unread";
		for (const [chatId, isPaused] of Object.entries(paused))
			if (isPaused) statuses[chatId] = "waiting";
		for (const chatId of streams.keys()) statuses[chatId] = "generating";
		for (const chatId of awaiting.values())
			if (chatId) statuses[chatId] = "waiting";
		return statuses;
	}, [chats, streams, paused, awaiting]);
};
