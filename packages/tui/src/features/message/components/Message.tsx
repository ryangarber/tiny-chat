import { Box, Text, useMouseInput } from "better-ink-ui";
import Spinner from "ink-spinner";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ClientContext } from "#client/client.ts";
import type { AgentStreamEvent } from "#client/core/services/StreamService.ts";
import { useStream } from "#client/features/agent/hooks/useStream.ts";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { useMessageBranches } from "#client/features/message/hooks/useMessageBranches.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import Button from "#tui/core/components/Button.tsx";
import ErrorBoundary from "#tui/core/components/ErrorBoundary.tsx";
import { useWidth } from "#tui/core/hooks/useWidth.ts";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import MessageParts from "#tui/features/message/components/MessageParts.tsx";
import SelectionActions, {
	type SelectionAction,
} from "#tui/features/selection/components/SelectionActions.tsx";

export default function Message({
	message,
	compaction,
}: {
	message: MessageState;
	compaction?: Compaction;
}) {
	const client = useContext(ClientContext);

	const columns = useWidth();

	const editing = useComposerStore((state) =>
		state.mode.kind === "edit" ? state.mode.message : null,
	);

	// A first press arms the delete, which a second within a moment puts through.
	const { deleteMessage } = useMessaging();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const confirmTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(confirmTimeout.current), []);

	const branch = useMessageBranches(message);
	const [branchHover, setBranchHover] = useState<number | null>(null);
	const { mouseRef: branchRef } = useMouseInput({
		isActive: branch.count > 1,
		onClick: ({ index }) => branch.select(index === 0 ? -1 : 1),
		onHoverStart: ({ index }) => setBranchHover(index),
		onHoverEnd: () => setBranchHover(null),
	});

	const stream = useStream<AgentStreamEvent>(message.id)?.items.at(-1);
	const streamed = { ...message, ...stream };

	// A passage of a reply is quoted into the message being written, or into a
	// new chat with this one attached, as the app offers over a selection.
	const { author, chatId } = message;
	const { model } = message.config;
	const actions = useMemo<SelectionAction[]>(
		() =>
			author !== "MODEL"
				? []
				: [
						{
							label: "quote",
							onSelect: (text) => {
								ComposerService.insertQuote({ client, model, text });
								useAppStore.getState().setFocus("editor");
							},
						},
						{
							label: "quote in new chat",
							onSelect: (text) => {
								useAppStore.getState().setFocus("editor");
								ChatService.quoteInNewChat({
									client,
									chatId,
									model,
									text,
								}).catch((error) =>
									console.warn(
										"[Message] failed to quote in a new chat",
										error,
									),
								);
							},
						},
					],
		[author, chatId, model, client],
	);

	return (
		// Two columns clear on the right: one for the transcript's scrollbar, and
		// one for the chapters marked beside it.
		<Box flexDirection="column" paddingLeft={1} paddingRight={2} paddingY={1}>
			<Box
				flexDirection="column"
				backgroundColor={message.author === "USER" ? "interior" : undefined}
				borderStyle="round"
				border={message.author === "USER"}
				paddingY={message.author === "USER" ? 1 : 0}
				paddingX={2}
				gap={1}
				maxWidth={columns - 3}
			>
				<SelectionActions actions={actions}>
					<ErrorBoundary label="this message" resetKey={streamed.data}>
						<MessageParts
							data={streamed.data}
							status={streamed.status}
							compaction={compaction}
							message={message}
						/>
					</ErrorBoundary>
				</SelectionActions>
				{!!streamed.status && (
					<Text>
						<Spinner type="simpleDotsScrolling" />
					</Text>
				)}
			</Box>
			<Box paddingLeft={2} paddingTop={1}>
				<Text color="textSubtle">➤ {message.config.model}</Text>
				{!streamed.status && (
					<Button
						marginLeft={2}
						label="copy"
						labelOnClick="copied"
						onClick={() =>
							ClipboardService.copy(
								DataUtils.getText({ data: message.data, join: "\n\n" }),
							)
						}
					/>
				)}
				{message.author === "USER" && (
					<Button
						marginLeft={2}
						label={editing?.id === message.id ? "cancel" : "edit"}
						onClick={() => {
							useAppStore.getState().setFocus("editor");
							if (editing?.id === message.id)
								ComposerService.cancel({ client });
							else ComposerService.edit({ client, message });
						}}
					/>
				)}
				<Button
					marginLeft={2}
					label={
						deleteMessage.isPending
							? "deleting…"
							: confirmingDelete
								? "confirm delete"
								: "delete"
					}
					disabled={deleteMessage.isPending}
					onClick={() => {
						clearTimeout(confirmTimeout.current);
						if (!confirmingDelete) {
							setConfirmingDelete(true);
							confirmTimeout.current = setTimeout(
								() => setConfirmingDelete(false),
								3000,
							);
							return;
						}
						setConfirmingDelete(false);
						deleteMessage.mutate(message);
					}}
				/>
				{branch.count > 1 && (
					<Box marginLeft={2} gap={1}>
						<Box ref={(element) => branchRef(element, 0)}>
							<Text dimColor={branch.index <= 0 || branchHover === 0}>
								{"<"}
							</Text>
						</Box>
						<Text>
							{branch.index + 1} / {branch.count}
						</Text>
						<Box ref={(element) => branchRef(element, 1)}>
							<Text
								dimColor={branch.index >= branch.count - 1 || branchHover === 1}
							>
								{">"}
							</Text>
						</Box>
					</Box>
				)}
			</Box>
		</Box>
	);
}
