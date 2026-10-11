import { type DOMElement, useInput, useWindowSize } from "ink";
import { useContext, useRef } from "react";
import { ThemeContext } from "#client/core/components/ThemeContext.tsx";
import { useConsoleStore } from "#client/core/stores/useConsoleStore.ts";
import Box from "#tui/core/components/Box.tsx";
import HelpText from "#tui/core/components/HelpText.tsx";
import LogView from "#tui/core/components/LogView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import { usePage } from "#tui/core/hooks/usePage.ts";

/**
 * Everything logged this session, over the whole screen. The CLI never prints
 * a log, which would force Ink into a full redraw, so this is where they are
 * read. Mounted only while open, so a log renders nothing otherwise.
 */
export default function Console() {
	const { colorScheme } = useContext(ThemeContext);
	const { rows, columns } = useWindowSize();

	const logs = useConsoleStore((state) => state.logs);
	const clearLogs = useConsoleStore((state) => state.clearLogs);

	const ref = useRef<DOMElement>(null);
	useMouseLayer(ref);

	usePage();
	useInput((input) => {
		if (input === "c") clearLogs();
	});

	return (
		<Box
			ref={ref}
			position="absolute"
			top={0}
			left={0}
			width={columns}
			height={rows}
			flexDirection="column"
			backgroundColor={colorScheme.exterior}
			padding={1}
		>
			<Box paddingBottom={1} gap={1}>
				<Text bold>console</Text>
				<Text color="textSubtle">{logs.length} lines</Text>
			</Box>
			<Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
				<LogView logs={logs} />
			</Box>
			<HelpText
				actions={[
					{ key: "↑↓", name: "scroll" },
					{ key: "c", name: "clear", onClick: clearLogs },
					"back",
				]}
			/>
		</Box>
	);
}
