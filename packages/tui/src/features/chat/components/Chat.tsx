import { useLayoutEffect, useMemo, useRef } from "react";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useCompletionStore } from "#client/features/editor/stores/useCompletionStore.ts";
import { useFindMessages } from "#client/features/find/hooks/useFindMessages.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { useShellCommand } from "#client/features/shell/hooks/useShellCommand.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import Box from "#tui/core/components/Box.tsx";
import ScrollView, {
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { selectFocus, useAppStore } from "#tui/core/stores/useAppStore.ts";
import GetStarted from "#tui/features/chat/components/GetStarted.tsx";
import Message from "#tui/features/message/components/Message.tsx";

export default function Chat({ compaction }: { compaction?: Compaction }) {
	const { chat } = useChat();
	const { messages } = useMessages();
	useWorkingStatus(chat, messages);

	const messageList = useMemo(
		() => messages.data?.messages ?? [],
		[messages.data],
	);

	// Brings a message asked for to the top once it has been laid out, which
	// may be a few passes away while the chat it is in loads.
	const ref = useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);
	const focusedMessage = useChatStore((state) =>
		state.active.status === "open" ? state.active.focusedMessage : null,
	);
	// A message find has a match in is scrolled into sight, which draws it;
	// once it is, find brings the match itself into view.
	useFindMessages(messageList, (id) => {
		const index = messageList.findIndex((message) => message.id === id);
		if (index >= 0) ref.current?.scrollToIndex(index, "auto");
	});

	// The page keys are the transcript's while the chat has the focus, but for
	// a list or shell output drawn over the editor, which scrolls itself.
	const focus = useAppStore(selectFocus);
	const isCompletionsOpen = useCompletionStore(
		(state) => state.isCompletionsOpen,
	);
	const shell = useShellCommand();
	const paging =
		(focus === "editor" || focus.startsWith("tool:")) &&
		!isCompletionsOpen &&
		!(shell.isOpen && shell.run);

	useLayoutEffect(() => {
		if (!focusedMessage || chat.isFetching || messages.isFetching) return;
		const index = messageList.findIndex((m) => m.id === focusedMessage);
		if (index < 0 || !ref.current?.getItemPosition(index)) return;
		useChatStore.getState().clearFocusedMessage();
		ref.current.scrollToIndex(index, "top");
	});

	if (!chat.data) {
		return (
			<Box
				flexDirection="column"
				flexGrow={1}
				flexShrink={1}
				flexBasis={0}
				minHeight={0}
				justifyContent="center"
			>
				{/* Centered while it fits, and scrolled once it does not. */}
				<ScrollView paging={paging} flexShrink={1} minHeight={0}>
					<Box flexDirection="column" alignItems="center">
						<GetStarted />
					</Box>
				</ScrollView>
			</Box>
		);
	}

	return (
		<ScrollView
			ref={ref}
			paging={paging}
			flexGrow={1}
			flexShrink={1}
			flexBasis={0}
			minHeight={0}
			stickToBottom
			resetKey={chat.data.id}
		>
			{messageList.map((message) => (
				<Message key={message.id} message={message} compaction={compaction} />
			))}
		</ScrollView>
	);
}
