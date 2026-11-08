import { useMemo } from "react";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";
import { useToolFeedbackStore } from "#client/features/part/stores/useToolFeedbackStore.ts";

/**
 * What a chat's reply is doing: generating, or waiting on the user to answer
 * one of its calls, whether its generation is still live or has stopped to.
 */
export type ChatStatus = "generating" | "waiting";

/** The status of one chat, if its reply is generating or waiting. */
export const useChatStatus = (chatId: string): ChatStatus | undefined => {
	const generating = useStreamStore((state) =>
		state.chatAgentStreams.has(chatId),
	);
	const paused = useMessageQueueStore((state) => !!state.paused[chatId]);
	const awaiting = useToolFeedbackStore((state) =>
		[...state.awaiting.values()].includes(chatId),
	);
	if (awaiting || (paused && !generating)) return "waiting";
	return generating ? "generating" : undefined;
};

/** The status of every chat with a reply generating or waiting, by chat. */
export const useChatStatuses = (): Record<string, ChatStatus> => {
	const streams = useStreamStore((state) => state.chatAgentStreams);
	const paused = useMessageQueueStore((state) => state.paused);
	const awaiting = useToolFeedbackStore((state) => state.awaiting);

	return useMemo(() => {
		const statuses: Record<string, ChatStatus> = {};
		for (const [chatId, isPaused] of Object.entries(paused))
			if (isPaused) statuses[chatId] = "waiting";
		for (const chatId of streams.keys()) statuses[chatId] = "generating";
		for (const chatId of awaiting.values())
			if (chatId) statuses[chatId] = "waiting";
		return statuses;
	}, [streams, paused, awaiting]);
};
