import { inspect, stripVTControlCharacters } from "node:util";
import { useInput } from "ink";
import { useRef } from "react";
import type { ConsoleLog } from "#client/core/stores/useConsoleStore.ts";
import { LogLevel } from "#core/logger.ts";
import Box from "#tui/core/components/Box.tsx";
import ScrollView, {
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";

/**
 * One logged value as plain text. Escapes are stripped, as a server's colored
 * output would otherwise move the cursor in the middle of the UI.
 */
const format = (value: unknown) =>
	stripVTControlCharacters(
		typeof value === "string"
			? value
			: inspect(value, { depth: 4, breakLength: Number.POSITIVE_INFINITY }),
	);

/** Log lines, newest last, held on the newest while resting there. */
export default function LogView({
	logs,
	active = true,
	empty = "nothing logged yet",
}: {
	logs: ConsoleLog[];
	/** Takes the scroll keys. */
	active?: boolean;
	empty?: string;
}) {
	const ref = useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);

	useInput(
		(_input, key) => {
			if (key.upArrow) ref.current?.scrollBy(-1);
			if (key.downArrow) ref.current?.scrollBy(1);
			if (key.home) ref.current?.scrollToTop();
			if (key.end) ref.current?.scrollToBottom();
		},
		{ isActive: active },
	);

	if (!logs.length) return <Text color="textSubtle">{empty}</Text>;

	return (
		<ScrollView
			ref={ref}
			paging={active}
			stickToBottom
			flexGrow={1}
			flexShrink={1}
			flexBasis={0}
			minHeight={0}
		>
			{logs.map((log) => (
				<Box key={log.id} gap={1}>
					<Text color="textSubtle">{log.time}</Text>
					<Box flexGrow={1} flexShrink={1} minWidth={0}>
						<Text
							color={
								log.level === LogLevel.error
									? "redBright"
									: log.level === LogLevel.warn
										? "yellowBright"
										: undefined
							}
						>
							{log.data.map(format).join(" ")}
						</Text>
					</Box>
				</Box>
			))}
		</ScrollView>
	);
}
