import Spinner from "ink-spinner";
import { useState } from "react";
import type {
	Categories,
	Usage,
} from "#client/features/editor/hooks/useEstimatedTokens.ts";
import Box from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import type { Color } from "#tui/core/hooks/useColor.ts";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";

export default function TokenUsage({
	usage,
	categories,
}: {
	usage: Usage<Color>;
	categories: Categories;
}) {
	const [expanded, setExpanded] = useState(false);

	const [hovered, setHovered] = useState(false);
	const { mouseRef } = useMouseInput({
		onHoverStart: () => setHovered(true),
		onHoverEnd: () => setHovered(false),
		onClick: () => setExpanded(!expanded),
	});

	return (
		<Box
			ref={mouseRef}
			flexDirection="column"
			justifyContent="flex-end"
			alignItems="flex-end"
			flexShrink={0}
			position={expanded ? "absolute" : undefined}
			bottom={0}
			right={0}
			backgroundColor={expanded ? "interior" : undefined}
			borderStyle="round"
			border={expanded}
			paddingX={expanded ? 1 : 0}
			minWidth={5}
		>
			<Box>
				<Box flexDirection="column" alignItems="flex-end">
					{expanded &&
						categories.map((category) => (
							<Text key={category.name} bold>
								{category.name.toLowerCase()}:{" "}
							</Text>
						))}
					{expanded && (
						<Text bold color={usage.color} dimColor={hovered}>
							total:{" "}
						</Text>
					)}
				</Box>
				<Box flexDirection="column" alignItems="flex-end">
					{expanded &&
						categories.map((category) => (
							<Text key={category.name}>
								{category.loading && <Spinner type="dots" />}
								{!category.loading &&
									Math.round(category.tokens).toLocaleString()}
							</Text>
						))}
					<Text color={usage.color} dimColor={hovered}>
						{usage.loading && <Spinner type="dots" />}
						{!usage.loading && `${Math.round(usage.percent)}%`}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
