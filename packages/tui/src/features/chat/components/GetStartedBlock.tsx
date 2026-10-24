import { useState } from "react";
import type {
	GetStartedBlock as GetStartedBlockType,
	GetStartedLink,
	GetStartedTarget,
} from "#client/features/chat/types/getStarted.ts";
import Box from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";

/** A row of links, opened by clicking one and highlighted while hovered. */
function Links({
	links,
	onOpen,
}: {
	links: GetStartedLink[];
	onOpen: (target: GetStartedTarget) => void;
}) {
	const [hover, setHover] = useState<number | null>(null);
	const { mouseRef } = useMouseInput({
		onClick: ({ index }) => {
			const link = links[index];
			if (link) onOpen(link.target);
		},
		onHoverStart: ({ index }) => setHover(index),
		onHoverEnd: ({ index }) =>
			setHover((current) => (current === index ? null : current)),
	});

	return (
		<Box flexDirection="column">
			{links.map((link, index) => (
				<Box
					// biome-ignore lint/suspicious/noArrayIndexKey: links are registered with the mouse by index
					key={index}
					ref={(element) => mouseRef(element, index)}
					gap={2}
					justifyContent="space-between"
				>
					<Text
						color={hover === index ? "primary" : undefined}
						wrap="truncate-end"
					>
						{link.label.replaceAll("\n", " ").toLowerCase()}
					</Text>
					{link.description && (
						<Box flexShrink={0}>
							<Text color="textSubtle">{link.description.toLowerCase()}</Text>
						</Box>
					)}
				</Box>
			))}
		</Box>
	);
}

/**
 * Draws one piece of a get-started widget. Each widget describes itself in
 * these blocks, so a new one needs no code here.
 */
export default function GetStartedBlock({
	block,
	onOpen,
}: {
	block: GetStartedBlockType;
	onOpen: (target: GetStartedTarget) => void;
}) {
	switch (block.type) {
		case "links":
			return <Links links={block.links} onOpen={onOpen} />;
	}
}
