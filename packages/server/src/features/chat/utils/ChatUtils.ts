import type { ChatState } from "#core/features/data/types/chat.ts";
import { ChatUtils as CoreChatUtils } from "#core/features/data/utils/ChatUtils.ts";

export const ChatUtils = {
	toChatState: (chat: Omit<ChatState, "unread">): ChatState => {
		return {
			...chat,
			unread:
				CoreChatUtils.getActivity(chat) >
				chat.readAt.toZonedDateTime("UTC").epochMilliseconds,
		};
	},
} as const;
