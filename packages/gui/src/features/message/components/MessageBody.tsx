import {
	ActionIcon,
	Alert,
	Box,
	type BoxProps,
	Group,
	Text,
} from "@mantine/core";
import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type CSSProperties, useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import type { AgentStreamEvent } from "#client/core/services/StreamService.ts";
import { useStream } from "#client/features/agent/hooks/useStream.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useMessageStore } from "#client/features/message/stores/useMessageStore.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import ErrorBoundary from "#gui/core/components/ErrorBoundary.tsx";
import MessageParts from "#gui/features/message/components/MessageParts.tsx";
import QuoteActions from "#gui/features/message/components/QuoteActions.tsx";
import { useMessageSelection } from "#gui/features/message/hooks/useMessageSelection.ts";

export default function MessageBody({
	message,
	style,
	compaction,
}: {
	message: MessageState;
	style?: CSSProperties;
	compaction?: Compaction;
}) {
	const stream = useStream<AgentStreamEvent>(message.id)?.items.at(-1);
	const streamed = { ...message, ...stream };

	// An earlier model message with a newer timestamp means the chat was edited
	// above this response. Resolved for the whole list in MessageProvider.
	const isStaleId = useMessageStore((s) => s.staleIds.has(message.id));
	const regenerate = useMessageStore((s) => s.regenerate);
	const resume = useMessageStore((s) => s.resume);

	const selection = useMessageSelection(message.id);
	const { getSelectedText } = selection;

	const client = useContext(ClientContext);
	const handleQuoteClick = () => {
		const text = getSelectedText();
		if (text)
			ComposerService.insertQuote({
				client,
				model: streamed.config.model,
				text,
			});
	};

	const handleQuoteInNewChatClick = () => {
		const text = getSelectedText();
		if (!text) return;
		ChatService.quoteInNewChat({
			client,
			chatId: streamed.chatId,
			model: streamed.config.model,
			text,
		}).catch((error) =>
			console.warn("[MessageBody] failed to quote in a new chat", error),
		);
	};

	const boxProps = useMemo<BoxProps>(() => {
		switch (streamed.author) {
			case "USER":
				return {
					px: 20,
					py: 10,
					bdrs: 20,
					style: {
						alignSelf: "flex-end",
						border: "1px solid var(--mantine-color-default-border)",
					},
					className: "glass",
					maw: "100%",
				};
			case "MODEL":
				return {
					w: "100%",
				};
		}
	}, [streamed.author]);

	const isStale = !streamed.status && isStaleId;

	return (
		<Group w="100%" justify="end" style={style}>
			<Box {...boxProps}>
				<Box display="inline" data-message-id={streamed.id}>
					{streamed.author === "MODEL" && isStale && (
						<Alert variant="light" mb="lg">
							<Group justify="space-between">
								<Group>
									<WarningCircleIcon size={20} />
									<Text>Edits in the chat may change this response</Text>
								</Group>
								<ActionIcon
									variant="subtle"
									onClick={() => regenerate(streamed)}
								>
									<ArrowClockwiseIcon size={20} />
								</ActionIcon>
							</Group>
						</Alert>
					)}
					<ErrorBoundary label="this message" resetKey={streamed.data}>
						<MessageParts
							message={streamed}
							data={streamed.data}
							status={streamed.status}
							compaction={compaction}
							regenerate={regenerate}
							resume={resume}
						/>
					</ErrorBoundary>
					{!!streamed.status && (
						<Box
							component="span"
							style={{ verticalAlign: "middle" }}
							className="shimmer-text active"
							fz="25px"
						>
							&middot;&middot;&middot;
						</Box>
					)}
					{streamed.author === "MODEL" && (
						<QuoteActions
							selection={selection}
							onQuote={handleQuoteClick}
							onQuoteInNewChat={handleQuoteInNewChatClick}
						/>
					)}
				</Box>
			</Box>
		</Group>
	);
}
