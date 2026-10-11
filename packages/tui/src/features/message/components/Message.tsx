import Spinner from "ink-spinner";
import { useContext, useState } from "react";
import { ClientContext } from "#client/client.ts";
import type { AgentStreamEvent } from "#client/core/services/StreamService.ts";
import { useStream } from "#client/features/agent/hooks/useStream.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { useMessageBranches } from "#client/features/message/hooks/useMessageBranches.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import Box from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { useWidth } from "#tui/core/hooks/useWidth.ts";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import MessageParts from "#tui/features/message/components/MessageParts.tsx";

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

	return (
		<Box flexDirection="column" paddingX={1} paddingY={1}>
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
				<MessageParts
					data={streamed.data}
					status={streamed.status}
					compaction={compaction}
					message={message}
				/>
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
