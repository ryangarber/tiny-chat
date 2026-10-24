import type { ReactNode } from "react";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatSourcesStore } from "#client/features/chat/stores/useChatSourcesStore.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { SourceUtils } from "#core/features/data/utils/SourceUtils.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";

const icon = (path: string) => {
	if (path.startsWith("chat:")) return "💬";
	if (path.startsWith("web:")) return SourceUtils.getTypeEmoji("web");
	if (path.startsWith("memory:")) return SourceUtils.getTypeEmoji("memory");
	if (path.startsWith("action:")) return SourceUtils.getTypeEmoji("action");
	return SourceUtils.getTypeEmoji("file");
};

/**
 * Any kind of source, by the path the app's chip takes: a file's own, or
 * `web:`, `memory:`, `action:` or `chat:` and its URL or ID. A click opens it
 * in the chat's sources, or goes to the chat.
 */
export default function SourceChip({
	path,
	web,
	directory = false,
	viewable = true,
	onOpen,
	children,
	...props
}: BoxProps & {
	path: string;
	web?: zWebContext;
	directory?: boolean;
	viewable?: boolean;
	/** Called once it has been opened. */
	onOpen?: () => void;
	children?: ReactNode;
}) {
	const { mouseRef } = useMouseInput({
		onClick: () => {
			// Another chat is read where it lives, not previewed as a file.
			if (path.startsWith("chat:")) {
				ChatService.setChat({ id: path.slice(5) });
			} else {
				const { chatId } = useChatStore.getState().active;
				useChatSourcesStore
					.getState()
					.viewFile({ path, directory, chatId, web });
				useAppStore.getState().openPanel("files");
			}
			onOpen?.();
		},
		isActive: viewable,
	});

	return (
		<Box ref={mouseRef} gap={1} {...props}>
			<Box flexShrink={0}>
				<Text>{icon(path)}</Text>
			</Box>
			{children}
		</Box>
	);
}
