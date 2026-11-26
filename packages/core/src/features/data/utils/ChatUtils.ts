import type { ChatState } from "#core/features/data/types/chat.ts";

const epoch = (time: ChatState["createdAt"]) =>
	time.toZonedDateTime("UTC").epochMilliseconds;

export const ChatUtils = {
	/** When the chat last had a message added, for ordering chats. */
	getTimestamp: (chat: ChatState) => {
		if (!chat) return -1;
		return Math.max(
			epoch(chat.createdAt),
			...chat.messages.map((message) => epoch(message.createdAt)),
		);
	},

	/** When anything last happened in the chat, a message written or rewritten. */
	getActivity: (chat: Pick<ChatState, "createdAt" | "messages">) =>
		Math.max(
			epoch(chat.createdAt),
			...chat.messages.map((message) =>
				epoch(message.updatedAt ?? message.createdAt),
			),
		),
};
