import {
	ActionIcon,
	Box,
	Button,
	Group,
	Modal,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { useDisclosure, useTimeout } from "@mantine/hooks";
import {
	ArrowBendDownLeftIcon,
	CopyIcon,
	PenIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	type CSSProperties,
	type ReactNode,
	useContext,
	useState,
} from "react";
import { ClientContext } from "#client/client.ts";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { useMessageBranches } from "#client/features/message/hooks/useMessageBranches.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import MessageBody from "#gui/features/message/components/MessageBody.tsx";

export default function Message({
	message,
	opacity,
	isLast,
	compaction,
}: {
	message: MessageState;
	opacity: number;
	isLast: boolean;
	compaction?: Compaction;
}) {
	const client = useContext(ClientContext);

	const branch = useMessageBranches(message);
	const { deleteMessage } = useMessaging();

	const editing = useComposerStore((s) =>
		s.mode.kind === "edit" ? s.mode.message : null,
	);
	const insertingAfter = useComposerStore((s) =>
		s.mode.kind === "insert" ? s.mode.after : null,
	);

	const [isNodeHovered, { open: onNodeHover, close: onNodeLeave }] =
		useDisclosure(false);
	const [isConfirmingDelete, { open: onConfirmDelete, close: onCancelDelete }] =
		useDisclosure(false);
	const runtime = useRuntime();
	const [copied, setCopied] = useState(false);
	const resetCopied = useTimeout(() => setCopied(false), 2000);

	const actions: ReactNode[] = [];
	if (!isLast) {
		actions.push(
			<Tooltip label="Insert Here" key="insert">
				<ActionIcon
					variant="subtle"
					size={32}
					onClick={() =>
						insertingAfter?.id === message.id
							? ComposerService.cancel({ client })
							: ComposerService.insertAfter({ client, message })
					}
				>
					{insertingAfter?.id === message.id ? (
						<XIcon size={20} />
					) : (
						<ArrowBendDownLeftIcon size={20} />
					)}
				</ActionIcon>
			</Tooltip>,
		);
	}

	const fade: CSSProperties = {
		opacity: opacity,
		transition: "opacity 0.2s",
	};

	return (
		<div data-message-id={message.id}>
			<div
				style={{
					display: "flex",
					justifyContent: message.author === "USER" ? "flex-end" : "flex-start",
					padding: "10px 0",
				}}
			>
				<Stack align={message.author === "USER" ? "end" : "start"} w="100%">
					<MessageBody message={message} style={fade} compaction={compaction} />
					<Box w="100%">
						<Group
							gap={0}
							justify={message.author === "USER" ? "end" : "space-between"}
						>
							<Group gap={0} style={fade}>
								{message.author === "USER" && branch.count > 1 && (
									<Group gap={4}>
										<ActionIcon
											variant="subtle"
											aria-label="Previous branch"
											disabled={branch.index <= 0}
											onClick={() => branch.select(-1)}
										>
											{"<"}
										</ActionIcon>
										<Text size="xs">
											{branch.index + 1} / {branch.count}
										</Text>
										<ActionIcon
											variant="subtle"
											aria-label="Next branch"
											disabled={branch.index >= branch.count - 1}
											onClick={() => branch.select(1)}
										>
											{">"}
										</ActionIcon>
										<Text size="xs" c="dimmed">
											<span style={{ padding: "0 10px 0 5px" }}>&middot;</span>
										</Text>
									</Group>
								)}
								<Tooltip label={copied ? "Copied" : "Copy"}>
									<ActionIcon
										variant="subtle"
										size={30}
										onClick={async () => {
											await ControlUtils.copy({
												runtime,
												data: DataUtils.getText({
													data: message.data,
													join: "\n",
												}),
												mime: "text/plain",
											});
											setCopied(true);
											resetCopied.start();
										}}
									>
										<CopyIcon size={20} />
									</ActionIcon>
								</Tooltip>
								{message.author === "USER" && (
									<Tooltip label="Edit">
										<ActionIcon
											variant="subtle"
											size={30}
											onClick={() =>
												editing?.id === message.id
													? ComposerService.cancel({ client })
													: ComposerService.edit({ client, message })
											}
										>
											{editing?.id !== message.id ? (
												<PenIcon size={20} />
											) : (
												<XIcon size={20} />
											)}
										</ActionIcon>
									</Tooltip>
								)}
								<Tooltip label="Delete">
									<ActionIcon
										variant="subtle"
										size={30}
										onClick={onConfirmDelete}
									>
										<TrashIcon size={20} />
									</ActionIcon>
								</Tooltip>
								{message.author === "MODEL" && (
									<Text
										size="xs"
										c="dimmed"
										style={{
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
											maxWidth: "33vw",
										}}
									>
										<span style={{ padding: "0 10px 0 5px" }}>&middot;</span>
										{message.config.model}
									</Text>
								)}
							</Group>
							{message.author === "MODEL" && actions.length !== 0 && (
								<Box
									opacity={
										isNodeHovered || insertingAfter?.id === message.id ? 1 : 0.5
									}
									onMouseEnter={onNodeHover}
									onMouseLeave={onNodeLeave}
									style={{ transition: "opacity 0.2s" }}
								>
									{actions}
								</Box>
							)}
						</Group>
					</Box>
				</Stack>
			</div>
			<Modal
				opened={isConfirmingDelete}
				onClose={onCancelDelete}
				title="Delete Message"
				centered
			>
				<Button
					variant="outline"
					color="red"
					fullWidth
					onClick={() => {
						deleteMessage.mutate(message, {
							onSuccess: () => onCancelDelete(),
						});
					}}
					loading={deleteMessage.isPending}
					disabled={deleteMessage.isPending}
				>
					Confirm
				</Button>
			</Modal>
		</div>
	);
}
