import { useGetStarted } from "#client/features/chat/hooks/useGetStarted.ts";
import Box from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import GetStartedBlock from "#tui/features/chat/components/GetStartedBlock.tsx";

/** Widest the widgets are drawn, centered in a wider terminal. */
const MAX_WIDTH = 60;

/** What the new chat page offers to get started with, one above the other. */
export default function GetStarted() {
	const { widgets, open } = useGetStarted();

	return (
		<Box
			flexDirection="column"
			gap={1}
			width="100%"
			maxWidth={MAX_WIDTH}
			paddingX={2}
		>
			{widgets.map((widget) => (
				<Box key={widget.id} flexDirection="column">
					<Text color="textSubtle">{widget.title.toLowerCase()}</Text>
					{widget.blocks.map((block, index) => (
						<GetStartedBlock
							// biome-ignore lint/suspicious/noArrayIndexKey: a widget's blocks keep their order
							key={index}
							block={block}
							onOpen={open}
						/>
					))}
				</Box>
			))}
		</Box>
	);
}
