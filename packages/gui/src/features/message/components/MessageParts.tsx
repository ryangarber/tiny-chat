import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { ArrowClockwiseIcon, PlayIcon } from "@phosphor-icons/react";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import type { AgentStreamEvent } from "#client/core/services/StreamService.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { EditorPartUtils } from "#core/features/data/utils/EditorPartUtils.ts";
import Code from "#gui/features/code/components/Code.tsx";
import FindSegment from "#gui/features/find/components/FindSegment.tsx";
import CompactionBadge from "#gui/features/message/components/CompactionBadge.tsx";
import Markdown from "#gui/features/message/components/Markdown.tsx";
import Image from "#gui/features/part/components/Image.tsx";
import Thought from "#gui/features/part/components/Thought.tsx";
import ToolGroup from "#gui/features/part/components/ToolGroup.tsx";

/* biome-ignore-start lint/suspicious/noArrayIndexKey: parts stay in order */
export default function MessageParts({
	message,
	data,
	status,
	compaction,
	regenerate,
	resume,
}: {
	message?: MessageState;
	data: zData;
	status?: AgentStreamEvent["status"];
	compaction?: Compaction;
	regenerate?: (message: MessageState) => void;
	resume?: (message: MessageState) => void;
}) {
	const parts = DataUtils.getRenderedPartsGrouped(
		data,
		status === "thinking",
		"thought",
		"toolCall",
	);

	// The last part stays open while the message is still streaming, so it does
	// not fold between one call or thought and whatever comes after it.
	const hold = (index: number) =>
		status !== undefined && index === parts.length - 1;

	return parts.map((part, index) => {
		if (EditorPartUtils.isRun(part)) {
			const previous = parts[index - 1];
			if (previous && EditorPartUtils.isRun(previous)) return null;
			const run = EditorPartUtils.toRun(parts.slice(index));
			return (
				<FindSegment key={index} id={run[0].id}>
					<div>
						{run.map((item) => (
							<CompactionBadge
								key={item.id}
								compaction={compaction}
								id={item.id}
							/>
						))}
						<Markdown source={[run]} streaming={status !== undefined} />
					</div>
				</FindSegment>
			);
		}
		if (part.type === "interjection")
			return (
				<FindSegment key={part.id} id={part.id}>
					<Stack bg="var(--tc-surface)" p="sm" gap="xs">
						<Text size="xs" c="dimmed">
							You
						</Text>
						<MessageParts data={[part.value]} compaction={compaction} />
					</Stack>
				</FindSegment>
			);
		if (part.type === "group" && part.of === "thought") {
			return (
				<FindSegment key={index} id={part.value[0].id}>
					<div>
						<CompactionBadge
							compaction={compaction}
							id={part.value.find((thought) => compaction?.has(thought.id))?.id}
						/>
						<Thought thoughts={part.value} hold={hold(index)} />
					</div>
				</FindSegment>
			);
		}
		if (part.type === "group" && part.of === "toolCall") {
			return (
				<ToolGroup
					key={index}
					message={message}
					parts={part.value}
					compaction={compaction}
					hold={hold(index)}
				/>
			);
		} else if (part.type === "json") {
			return (
				<div key={index}>
					<CompactionBadge compaction={compaction} id={part.id} />
					<Code
						language="json"
						code={JSON.stringify(part.value, null, 4)}
						streaming={status !== undefined}
					/>
				</div>
			);
		} else if (part.type === "file") {
			if (part.mime.startsWith("image/")) {
				return (
					<div key={index}>
						<CompactionBadge compaction={compaction} id={part.id} />
						<Image
							src={`data:${part.mime};base64,${part.data}`}
							filename={part.name}
							radius="md"
							maw="100%"
							w="auto"
							my={4}
						/>
					</div>
				);
			} else if (part.mime.startsWith("audio/")) {
				return (
					<div key={index}>
						<CompactionBadge compaction={compaction} id={part.id} />
						<AudioPlayer title={part.name}>
							<AudioSkin>
								<Audio
									src={`data:${part.mime};base64,${part.data}`}
									playsInline
								/>
							</AudioSkin>
						</AudioPlayer>
					</div>
				);
			} else if (part.mime.startsWith("video/")) {
				return (
					<div key={index}>
						<CompactionBadge compaction={compaction} id={part.id} />
						<VideoPlayer title={part.name}>
							<VideoSkin>
								<Video
									src={`data:${part.mime};base64,${part.data}`}
									playsInline
								/>
							</VideoSkin>
						</VideoPlayer>
					</div>
				);
			}
		} else if (part.type === "abort") {
			return (
				<FindSegment key={index} id={part.id}>
					<Alert
						mb={10}
						color={part.reason === "error" ? "red" : "gray"}
						variant="light"
						title={`${part.reason === "error" ? "Failed" : "Stopped"}: ${part.reason}`}
					>
						<Stack align="flex-end">
							<Text size="sm" w="100%">
								{part.message ?? JSON.stringify(part.details)}
							</Text>
							{/* Once the reply carries on past it, it has nothing left to offer. */}
							{message &&
								status === undefined &&
								index === parts.length - 1 && (
									<Group gap="xs">
										{resume && (
											<Button
												variant="subtle"
												color="dimmed"
												onClick={() => resume(message)}
												leftSection={<PlayIcon size={20} />}
											>
												Continue
											</Button>
										)}
										{regenerate && (
											<Button
												variant="subtle"
												color="dimmed"
												onClick={() => regenerate(message)}
												leftSection={<ArrowClockwiseIcon size={20} />}
											>
												Retry
											</Button>
										)}
									</Group>
								)}
						</Stack>
					</Alert>
				</FindSegment>
			);
		}
		return null;
	});
} /* biome-ignore-end lint/suspicious/noArrayIndexKey: parts stay in order */
