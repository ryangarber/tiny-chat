import { ActionIcon, Box, Group, Tooltip } from "@mantine/core";
import { PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { type ReactNode, type Ref, useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";

function Effect({
	content,
	onDelete,
	onSend,
	isAny,
}: {
	content: ReactNode;
	onDelete: () => void;
	/** Sends it now, rather than when it would be. */
	onSend?: () => void;
	isAny: boolean;
}) {
	return (
		<Group
			className="glass"
			align="center"
			gap={5}
			px={10}
			py={5}
			mr={5}
			mb={5}
			w="fit-content"
			bdrs={25}
			fz={14}
			opacity={isAny ? 0.5 : 1}
			style={{
				border: "1px solid var(--mantine-color-default-border)",
				pointerEvents: "auto",
			}}
		>
			<ActionIcon
				size={20}
				variant="subtle"
				color="dimmed"
				onClick={onDelete}
				disabled={isAny}
			>
				<XIcon size={20} />
			</ActionIcon>
			<Box>{content}</Box>
			{onSend && (
				<Tooltip label="Send now" withArrow>
					<ActionIcon
						size={20}
						variant="subtle"
						color="dimmed"
						onClick={onSend}
						disabled={isAny}
						aria-label="Send now"
					>
						<PaperPlaneTiltIcon size={16} />
					</ActionIcon>
				</Tooltip>
			)}
		</Group>
	);
}

export default function ChatEffects({
	inputEffectsRef,
	inputMaxWidth,
	bottom,
	disabled,
}: {
	inputEffectsRef: Ref<HTMLDivElement>;
	inputMaxWidth: number;
	bottom: number;
	disabled: boolean;
}) {
	const client = useContext(ClientContext);
	const { sendQueued } = useMessaging();

	const chatId = useChatStore((s) => s.active.chatId);
	const queues = useMessageQueueStore((s) => s.queues);
	const editing = useComposerStore((s) =>
		s.mode.kind === "edit" ? s.mode.message : null,
	);
	const insertingAfter = useComposerStore((s) =>
		s.mode.kind === "insert" ? s.mode.after : null,
	);
	const keepingLater = useComposerStore(
		(s) => s.mode.kind === "edit" && !s.mode.truncate,
	);
	const isMobile = useAppStore((s) => s.isMobile);

	return (
		<Group
			pos="absolute"
			bottom={bottom}
			left={isMobile ? 10 : 20}
			right={isMobile ? 10 : 20}
			justify="center"
			style={{
				pointerEvents: "none",
				zIndex: "calc(var(--mantine-z-index-app) + 1)",
			}}
		>
			<div style={{ width: "100%", maxWidth: inputMaxWidth - 40 }}>
				<Group gap={0} ref={inputEffectsRef}>
					{chatId &&
						queues[chatId]?.map((part) => (
							<Effect
								key={part.id}
								content={`Queued: ${DataUtils.getTextCleaned({ data: [part.value], maxLength: 60 }) || "Attachment"}`}
								onDelete={() =>
									useMessageQueueStore.getState().remove(chatId, part.id)
								}
								onSend={() => sendQueued.mutate({ chatId, id: part.id })}
								isAny={sendQueued.isPending}
							/>
						))}
					{editing && (
						<Effect
							content={
								<>
									Editing{" "}
									<span style={{ color: "#aaa" }}>
										{DataUtils.getTextCleaned({
											data: editing.data,
											maxLength: 20,
										})}
									</span>
								</>
							}
							onDelete={() => ComposerService.cancel({ client })}
							isAny={disabled}
						/>
					)}
					{editing && !keepingLater && (
						<Effect
							content="Dropping later messages"
							onDelete={() => useComposerStore.getState().keepLater()}
							isAny={disabled}
						/>
					)}
					{insertingAfter && (
						<Effect
							content={
								<>
									Inserting after{" "}
									<span style={{ color: "#aaa" }}>
										{DataUtils.getTextCleaned({
											data: insertingAfter.data,
											maxLength: 20,
										})}
									</span>
								</>
							}
							onDelete={() => ComposerService.cancel({ client })}
							isAny={disabled}
						/>
					)}
				</Group>
			</div>
		</Group>
	);
}
