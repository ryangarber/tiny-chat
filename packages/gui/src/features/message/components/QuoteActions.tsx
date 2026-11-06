import { ActionIcon, Group, Portal, Transition } from "@mantine/core";
import { ChatCircleIcon, ChatsCircleIcon } from "@phosphor-icons/react";
import type { UseMessageSelectionReturn } from "#gui/features/message/hooks/useMessageSelection.ts";

/**
 * The buttons floated over a selection that can be quoted: into the message
 * being written, and — where there is a chat to take along — into a new one.
 */
export default function QuoteActions({
	selection: { rect, captureSelection },
	onQuote,
	onQuoteInNewChat,
}: {
	selection: Pick<UseMessageSelectionReturn, "rect" | "captureSelection">;
	onQuote: () => void;
	onQuoteInNewChat?: () => void;
}) {
	return (
		<Portal target={document.body}>
			<Transition mounted={rect !== null} transition="fade">
				{(styles) => (
					<Group
						gap={6}
						wrap="nowrap"
						style={{
							position: "fixed",
							top: (rect?.top ?? 0) - 30,
							left: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
							transform: "translateX(-50%)",
							// Above a modal, for content quoted from its expanded view.
							zIndex: "calc(var(--mantine-z-index-modal) + 1)",
							...styles,
						}}
					>
						<ActionIcon
							className="glass-shadow"
							size={32}
							title="Quote"
							aria-label="Quote"
							onMouseDown={captureSelection}
							onTouchStart={captureSelection}
							onClick={onQuote}
						>
							<ChatCircleIcon size={18} style={{ transform: "scale(-1,1)" }} />
						</ActionIcon>
						{onQuoteInNewChat && (
							<ActionIcon
								className="glass-shadow"
								size={32}
								title="Quote in a new chat"
								aria-label="Quote in a new chat"
								onMouseDown={captureSelection}
								onTouchStart={captureSelection}
								onClick={onQuoteInNewChat}
							>
								<ChatsCircleIcon size={18} />
							</ActionIcon>
						)}
					</Group>
				)}
			</Transition>
		</Portal>
	);
}
