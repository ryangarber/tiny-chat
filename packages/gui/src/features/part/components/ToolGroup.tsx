import { Box, Collapse } from "@mantine/core";
import { StackIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import {
	useFindHidden,
	useFindRevealed,
	useFindRevealing,
} from "#client/features/find/hooks/useFindScope.ts";
import { useMessageStore } from "#client/features/message/stores/useMessageStore.ts";
import { useAutoExpand } from "#client/features/part/hooks/useAutoExpand.ts";
import { useExpandStore } from "#client/features/part/stores/useExpandStore.ts";
import type { Compaction } from "#core/features/agent/services/AgentTokensService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import CompactionBadge from "#gui/features/message/components/CompactionBadge.tsx";
import Tail from "#gui/features/part/components/Tail.tsx";
import ToolCall from "#gui/features/part/components/ToolCall.tsx";
import ToolHeader from "#gui/features/part/components/ToolHeader.tsx";

/** Height the run is held to while it is open on its own. */
const TAIL_HEIGHT = 400;

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
	const groupKey = `group:${parts[0]?.id}`;
	// Open for find showing a match in one of its calls, or in a run of them
	// inside a segment, such as a subagent's.
	const revealing = useFindRevealing(parts.map((part) => part.id));
	const revealed = useFindRevealed();
	const { expanded, auto, toggle } = useAutoExpand(
		groupKey,
		group.pending || !!hold,
		revealing || revealed,
	);
	useFindHidden(!expanded && parts.length > 1);

	// Opens to let a call in it that is being gone to be drawn.
	const focusing = useExpandStore(
		(s) => !!s.focused && parts.some((part) => part.id === s.focused),
	);
	useEffect(() => {
		if (focusing && !expanded && parts.length > 1)
			useExpandStore.getState().setOverride(groupKey, true);
	}, [focusing, expanded, groupKey, parts.length]);

	// A lone call is its own header.
	if (parts.length === 1)
		return (
			<div>
				<CompactionBadge compaction={compaction} id={parts[0].id} />
				<ToolCall
					message={message}
					part={parts[0]}
					answerable={pendingFeedbackIds.includes(parts[0].id)}
					hold={hold}
				/>
			</div>
		);

	return (
		<Box my={10}>
			<ToolHeader
				icon={
					<StackIcon
						size={20}
						color="var(--mantine-color-dimmed)"
						className="shrink-0"
					/>
				}
				status={group.status}
				active={group.pending}
				expanded={expanded}
				onToggle={toggle}
			/>
			<Collapse expanded={expanded} keepMounted={false}>
				<Tail follow={auto} height={TAIL_HEIGHT} content={parts}>
					<Box pl="md" ml={9} mt={4}>
						{parts.map((part) => (
							<div key={part.id}>
								<CompactionBadge compaction={compaction} id={part.id} />
								<ToolCall
									message={message}
									part={part}
									answerable={pendingFeedbackIds.includes(part.id)}
								/>
							</div>
						))}
					</Box>
				</Tail>
			</Collapse>
		</Box>
	);
}
