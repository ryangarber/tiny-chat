import { useInput, useWindowSize } from "ink";
import { useContext, useRef } from "react";
import { ClientContext } from "#client/client.ts";
import { useToolCall } from "#client/features/part/hooks/useToolCall.ts";
import { useShellCommand } from "#client/features/shell/hooks/useShellCommand.ts";
import type { ShellRun } from "#client/features/shell/stores/useShellStore.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import Box from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import HelpText from "#tui/core/components/HelpText.tsx";
import ScrollView, {
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import Task from "#tui/features/part/components/Task.tsx";
import ToolBlock from "#tui/features/part/components/ToolBlock.tsx";
import { toStatusParts } from "#tui/features/part/components/ToolCall.tsx";

/**
 * The last command run with `!`, drawn as the tool call it is: its status,
 * then the command and its output, all of it scrollable while it streams in.
 */
function ShellRunView({
	run,
	toolsets,
	onDismiss,
}: {
	run: ShellRun;
	toolsets: Toolset<any>[];
	onDismiss: () => void;
}) {
	const { rows } = useWindowSize();
	const ref = useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);
	const display = useToolCall({ part: run, toolsets });
	const { interrupt } = display;

	useInput((_input, key) => {
		const page = Math.max(1, (ref.current?.getViewportHeight() ?? 1) - 2);
		if (key.pageUp) ref.current?.scrollBy(-page);
		if (key.pageDown) ref.current?.scrollBy(page);
		if (key.escape) {
			if (interrupt) interrupt();
			else onDismiss();
		}
	});

	return (
		// Always open: there is nothing for its status line to fold away.
		<Task expanded paddingX={0}>
			<Box gap={1}>
				<Task.Status
					status={
						display.active
							? "pending"
							: display.state === "error"
								? "error"
								: "success"
					}
					emoji="⚙️ "
					parts={toStatusParts(display.status)}
				/>
				{interrupt && <Button label="stop" onClick={interrupt} />}
			</Box>
			<ScrollView
				ref={ref}
				stickToBottom
				resetKey={run.id}
				maxHeight={Math.floor(rows / 2)}
				flexShrink={0}
				paddingTop={1}
			>
				{[...display.input, ...display.output].map((block, index) => (
					<Box
						// biome-ignore lint/suspicious/noArrayIndexKey: a tool's blocks keep their order
						key={index}
						paddingBottom={1}
						flexDirection="column"
					>
						<ToolBlock
							block={block}
							active={display.state === "running"}
							tail={false}
						/>
					</Box>
				))}
			</ScrollView>
			<HelpText
				actions={[
					{ key: "ctrl+enter", name: "run" },
					{ key: "pgup/pgdn", name: "scroll" },
					interrupt
						? { key: "esc", name: "stop", onClick: interrupt }
						: { key: "esc", name: "close", onClick: onDismiss },
				]}
			/>
		</Task>
	);
}

/**
 * Shell mode, over the editor like its completions: what is written there
 * after a `!` runs as a command instead of being sent.
 */
export default function Shell() {
	const client = useContext(ClientContext);
	const { run, toolsets, isOpen, dismiss } = useShellCommand();

	if (!isOpen) return null;

	return (
		<Box
			padding={1}
			flexDirection="column"
			flexShrink={0}
			backgroundColor="interior"
			borderStyle="round"
			border={true}
		>
			{run ? (
				<ShellRunView run={run} toolsets={toolsets} onDismiss={dismiss} />
			) : (
				<>
					<Box paddingBottom={1}>
						<Text color="textSubtle">
							{client.shell
								? "runs a command in your shell"
								: "runs a command in this chat's files"}
						</Text>
					</Box>
					<HelpText actions={[{ key: "ctrl+enter", name: "run" }]} />
				</>
			)}
		</Box>
	);
}
