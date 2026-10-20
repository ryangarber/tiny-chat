import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { StreamContext } from "#client/features/message/components/StreamContext.tsx";
import {
	type MarkdownSource,
	processor,
	useMarkdown,
} from "#client/features/message/hooks/useMarkdown.ts";
import { useMarkdownBlocks } from "#client/features/message/hooks/useMarkdownBlocks.ts";
import type { zEditorPart } from "#core/features/data/utils/EditorPartUtils.ts";
import Box from "#tui/core/components/Box.tsx";
import type { Color } from "#tui/core/hooks/useColor.ts";
import { MarkdownComponents } from "#tui/features/message/components/MarkdownComponents.tsx";

/**
 * One top-level markdown block.
 *
 * The memo is the point of the split: while a message streams, only the last
 * block's source changes, so every block above it keeps its element tree, and
 * with it the Ink nodes and the layout Yoga already measured for them. It is
 * spelled out rather than left to the compiler, which takes a function that
 * returns no JSX of its own for something other than a component, and would
 * otherwise leave every block to be parsed again on every render.
 */
const MarkdownBlock = memo(function MarkdownBlock({
	source,
	parts,
}: {
	source: string;
	parts: readonly zEditorPart[];
}) {
	return toJsxRuntime(
		processor.runSync(processor.parse(source), { data: { parts } }),
		{
			Fragment,
			components: MarkdownComponents,
			jsx,
			jsxs,
			ignoreInvalidStyle: true,
			passKeys: true,
			passNode: true,
		},
	);
});

export default function Markdown({
	source,
	streaming = false,
	textColor,
}: {
	source: MarkdownSource;
	streaming?: boolean;
	textColor?: Color;
}) {
	const { content, parts } = useMarkdown({ source });
	const blocks = useMarkdownBlocks({ content, streaming });

	// Only the last block can still be growing; the ones above it are final.
	return (
		<Box flexDirection="column" gap={1} color={textColor}>
			{blocks.map((block, index) => (
				<StreamContext
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks stay in order
					key={index}
					value={streaming && index === blocks.length - 1}
				>
					<MarkdownBlock source={block} parts={parts} />
				</StreamContext>
			))}
		</Box>
	);
}
