import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import Box from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import Text from "#tui/core/components/Text.tsx";

function Effect({
	content,
	onDelete,
	onSend,
}: {
	content: string;
	onDelete: () => void;
	/** Sends it now, rather than when it would be. */
	onSend?: () => void;
}) {
	return (
		<Box gap={1}>
			<Button label="×" onClick={onDelete} />
			<Text>{content}</Text>
			{onSend && <Button label="send now" onClick={onSend} />}
		</Box>
	);
}
export default function ChatEffects() {
	const client = useContext(ClientContext);
	const { sendQueued } = useMessaging();
	const chatId = useChatStore((s) => s.active.chatId);
	const queues = useMessageQueueStore((s) => s.queues);
	const editing = useComposerStore((s) =>
		s.mode.kind === "edit" ? s.mode.message : null,
	);
	const keepingLater = useComposerStore(
		(s) => s.mode.kind === "edit" && !s.mode.truncate,
	);
	const insertingAfter = useComposerStore((s) =>
		s.mode.kind === "insert" ? s.mode.after : null,
	);

	const hasEffect =
		editing ||
		keepingLater ||
		insertingAfter ||
		(chatId && queues[chatId]?.length > 0);

	if (!hasEffect) return null;

	return (
		<Box flexDirection="column" paddingX={2} paddingBottom={1}>
			{editing && (
				<Effect
					content={`editing ${DataUtils.getTextCleaned({ data: editing.data, maxLength: 40 }).toLowerCase()}`}
					onDelete={() => ComposerService.cancel({ client })}
				/>
			)}
			{editing && !keepingLater && (
				<Effect
					content="dropping later messages"
					onDelete={() => useComposerStore.getState().keepLater()}
				/>
			)}
			{insertingAfter && (
				<Effect
					content={`inserting after ${DataUtils.getTextCleaned({ data: insertingAfter.data, maxLength: 40 }).toLowerCase()}`}
					onDelete={() => ComposerService.cancel({ client })}
				/>
			)}
			{chatId &&
				queues[chatId]?.map((part) => (
					<Effect
						key={part.id}
						content={`Queued: ${DataUtils.getTextCleaned({ data: [part.value], maxLength: 60 }) || "Attachment"}`}
						onDelete={() =>
							useMessageQueueStore.getState().remove(chatId, part.id)
						}
						onSend={
							sendQueued.isPending
								? undefined
								: () => sendQueued.mutate({ chatId, id: part.id })
						}
					/>
				))}
		</Box>
	);
}
