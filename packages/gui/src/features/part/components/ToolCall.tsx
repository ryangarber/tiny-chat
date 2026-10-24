import { Box, Collapse, Stack } from "@mantine/core";
import { WrenchIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";
import { useAutoExpand } from "#client/features/part/hooks/useAutoExpand.ts";
import { useToolCall } from "#client/features/part/hooks/useToolCall.ts";
import { useExpandStore } from "#client/features/part/stores/useExpandStore.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import FindSegment from "#gui/features/find/components/FindSegment.tsx";
import Tail from "#gui/features/part/components/Tail.tsx";
import ToolBlock from "#gui/features/part/components/ToolBlock.tsx";
import ToolControls from "#gui/features/part/components/ToolControls.tsx";
import ToolHeader from "#gui/features/part/components/ToolHeader.tsx";

/** Height the call is held to while it is open on its own. */
const TAIL_HEIGHT = 400;

type ToolCallProps = {
	message?: MessageState;
	part: Extract<RenderedPart, { type: "toolCall" }>;
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
	const empty = !display.input.length && !display.output.length && !controls;

	const { expanded, auto, toggle } = useAutoExpand(
		part.id,
		display.active || !!hold,
		useFindRevealed(),
	);
	useFindHidden(!expanded && !empty);

	// Brought into view when gone to, such as from a citation of it.
	const ref = useRef<HTMLDivElement>(null);
	const focused = useExpandStore((s) => s.focused === part.id);
	useEffect(() => {
		const node = ref.current;
		if (!focused || !node) return;
		useExpandStore.getState().focus(null);
		node.scrollIntoView({ behavior: "smooth", block: "center" });
		node.animate(
			[
				{
					backgroundColor: "var(--mantine-color-blue-light)",
					borderRadius: "var(--mantine-radius-md)",
				},
				{
					backgroundColor: "transparent",
					borderRadius: "var(--mantine-radius-md)",
				},
			],
			{ duration: 1500, easing: "ease-out" },
		);
	}, [focused]);

	return (
		<Box my={8} ref={ref}>
			<ToolHeader
				icon={
					<WrenchIcon
						size={20}
						color="var(--mantine-color-dimmed)"
						className="shrink-0"
					/>
				}
				status={display.status}
				active={display.active}
				error={display.state === "error"}
				expanded={expanded && !empty}
				onToggle={empty ? undefined : toggle}
				onInterrupt={display.interrupt}
			/>
			<Collapse expanded={expanded && !empty} keepMounted={false}>
				<Box
					style={{
						borderLeft: "2px solid var(--mantine-color-default-border)",
					}}
					pl="md"
					py="xs"
					ml={9}
					mt={4}
				>
					<Tail follow={auto} height={TAIL_HEIGHT} content={part}>
						<Stack gap="xs" style={{ zoom: 0.9 }}>
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
						</Stack>
					</Tail>
				</Box>
			</Collapse>
		</Box>
	);
}
