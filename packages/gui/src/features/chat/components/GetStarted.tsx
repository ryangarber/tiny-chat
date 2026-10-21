import { SimpleGrid, Stack, Text } from "@mantine/core";
import { useGetStarted } from "#client/features/chat/hooks/useGetStarted.ts";
import GetStartedBlock from "#gui/features/chat/components/GetStartedBlock.tsx";

/** What the new chat page offers to get started with, side by side. */
export default function GetStarted() {
	const { widgets, open } = useGetStarted();

	return (
		<SimpleGrid
			cols={{ base: 1, sm: Math.max(1, widgets.length) }}
			spacing="xl"
			verticalSpacing="lg"
			w="100%"
			maw={860}
			px={20}
			style={{
				opacity: widgets.length ? 1 : 0,
				transition: "opacity 300ms ease",
			}}
		>
			{widgets.map((widget) => (
				<Stack key={widget.id} gap={4} miw={0}>
					<Text size="sm" c="dimmed" fw={500} px="sm">
						{widget.title}
					</Text>
					{widget.blocks.map((block, index) => (
						<GetStartedBlock
							// biome-ignore lint/suspicious/noArrayIndexKey: a widget's blocks keep their order
							key={index}
							block={block}
							onOpen={open}
						/>
					))}
				</Stack>
			))}
		</SimpleGrid>
	);
}
