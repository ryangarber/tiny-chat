import chalk from "chalk";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";
import { useAutoExpand } from "#client/features/part/hooks/useAutoExpand.ts";
import { useToolCall } from "#client/features/part/hooks/useToolCall.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import type { ToolStatusPart } from "#core/features/tool/types/display.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import Box from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import FindSegment from "#tui/features/find/components/FindSegment.tsx";
import Tail from "#tui/features/part/components/Tail.tsx";
import Task from "#tui/features/part/components/Task.tsx";
import ToolBlock from "#tui/features/part/components/ToolBlock.tsx";
import ToolControls from "#tui/features/part/components/ToolControls.tsx";
import type { StatusPart } from "#tui/features/part/utils/TaskUtils.ts";

export const toStatusParts = (status: ToolStatusPart[]): StatusPart[] =>
	status.map((part) =>
		part.subject ? { text: part.text, style: chalk.bold } : { text: part.text },
	);

type ToolCallProps = {
	message?: MessageState;
	part: Extract<RenderedPart, { type: "toolCall" }>;
	/** Waiting on feedback, so its controls can take the focus. */
	answerable?: boolean;
	/** Keeps it open after it settles, until something follows it. */
	hold?: boolean;
	/** Where its tool is looked up, for a call made outside of the messages. */
	toolsets?: Toolset<any>[];
};

/**
 * A tool call: open while it streams in, runs or waits on the user, showing
 * its input, then any controls, then its output as it arrives; folded back to
 * its status line once it settles.
 */
export default function ToolCall(props: ToolCallProps) {
	return (
		<FindSegment id={props.part.id}>
			<ToolCallBody {...props} />
		</FindSegment>
	);
}

function ToolCallBody({
	message,
	part,
	answerable,
	hold,
	toolsets,
}: ToolCallProps) {
	const display = useToolCall({ part, toolsets });
	const controls = message && display.controls;
	const { interrupt } = display;
	const empty = !display.input.length && !display.output.length && !controls;

	const { expanded, auto, toggle } = useAutoExpand(
		part.id,
		display.active || !!hold,
		useFindRevealed(),
	);
	useFindHidden(!expanded && !empty);

	return (
		<Task expanded={expanded} onToggle={toggle}>
			<Box gap={1}>
				<Task.Status
					status={
						display.active
							? "pending"
							: display.state === "error"
								? "error"
								: "success"
					}
					emoji="🔧"
					parts={toStatusParts(display.status)}
				/>
				{interrupt && <Button label="stop" onClick={interrupt} />}
			</Box>
			{!empty && (
				<Task.Details>
					<Tail follow={auto}>
						<Box flexDirection="column" gap={1}>
							{display.input.map((block, index) => (
								<ToolBlock
									// biome-ignore lint/suspicious/noArrayIndexKey: a tool's blocks keep their order
									key={`input-${index}`}
									block={block}
									active={display.state === "input"}
								/>
							))}
							{controls && message && (
								<ToolControls
									message={message}
									part={part}
									controls={controls}
									answerable={answerable}
								/>
							)}
							{display.output.map((block, index) => (
								<ToolBlock
									// biome-ignore lint/suspicious/noArrayIndexKey: a tool's blocks keep their order
									key={`output-${index}`}
									block={block}
									active={display.state === "running"}
								/>
							))}
						</Box>
					</Tail>
				</Task.Details>
			)}
		</Task>
	);
}
