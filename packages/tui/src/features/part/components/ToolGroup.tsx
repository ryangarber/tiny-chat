import {
	useFindHidden,
	useFindRevealed,
	useFindRevealing,
} from "#client/features/find/hooks/useFindScope.ts";
import { useMessageStore } from "#client/features/message/stores/useMessageStore.ts";
import { useAutoExpand } from "#client/features/part/hooks/useAutoExpand.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import Box from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import Tail from "#tui/features/part/components/Tail.tsx";
import Task from "#tui/features/part/components/Task.tsx";
import ToolCall, {
	toStatusParts,
} from "#tui/features/part/components/ToolCall.tsx";

function CompactionBadge({
	compaction,
	id,
}: {
	compaction?: Compaction;
	id?: string;
}) {
	const status = id ? compaction?.get(id) : undefined;
	return status ? <Text color="yellow">[{status}]</Text> : null;
}

/**
 * A run of consecutive tool calls. While any of it is moving, and until
 * something other than another call follows it, the run stays open so each
 * call can be watched as it goes; then it folds into one line counting what
 * was done.
 */
export default function ToolGroup({
	message,
	parts,
	compaction,
	hold,
}: {
	message?: MessageState;
	parts: Extract<RenderedPart, { type: "toolCall" }>[];
	compaction?: Compaction;
	/** Keeps it open after it settles, until something follows it. */
	hold?: boolean;
}) {
	const toolsets = useMessageStore((s) => s.toolsets);
	const pendingFeedbackIds = useMessageStore((s) => s.pendingFeedbackIds);

	const group = ToolCallUtils.getGroup({ parts, toolsets });
	// Open for find showing a match in one of its calls, or in a run of them
	// inside a segment, such as a subagent's.
	const revealing = useFindRevealing(parts.map((part) => part.id));
	const revealed = useFindRevealed();
	const { expanded, auto, toggle } = useAutoExpand(
		`group:${parts[0]?.id}`,
		group.pending || !!hold,
		revealing || revealed,
	);
	useFindHidden(!expanded && parts.length > 1);

	const items = parts.map((part) => (
		<Box key={part.id} flexDirection="column">
			<CompactionBadge compaction={compaction} id={part.id} />
			<ToolCall
				message={message}
				part={part}
				answerable={pendingFeedbackIds.includes(part.id)}
				hold={parts.length === 1 ? hold : undefined}
			/>
		</Box>
	));

	return (
		<Task.Group>
			{parts.length === 1 ? (
				// A lone call is its own header.
				items[0]
			) : (
				<Task expanded={expanded} onToggle={toggle}>
					<Task.Status
						status={group.pending ? "pending" : "success"}
						emoji="🧰"
						parts={toStatusParts(group.status)}
					/>
					<Task.Details
						paddingY={0}
						paddingLeft={0}
						backgroundColor={undefined}
					>
						<Tail follow={auto}>
							<Box flexDirection="column" gap={1} marginTop={1}>
								{items}
							</Box>
						</Tail>
					</Task.Details>
				</Task>
			)}
		</Task.Group>
	);
}
