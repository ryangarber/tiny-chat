import { useMemo, useState } from "react";
import remend from "remend";
import {
	type MarkdownBlocks,
	MarkdownUtils,
} from "#client/features/message/utils/MarkdownUtils.ts";

/**
 * The top-level blocks of a markdown document, for a renderer that lays out and
 * memoizes them one by one.
 *
 * Blocks that did not change keep their identity, so a memoized block component
 * renders once no matter how much more of the message arrives after it.
 *
 * @param streaming Close what an unfinished stream left open. Only the last
 * 	block can have anything open, so the earlier ones are passed through as they
 * 	are — and stay identical to the render before.
 */
export const useMarkdownBlocks = ({
	content,
	streaming,
}: {
	content: string;
	streaming?: boolean;
}) => {
	// Kept across renders so an append only costs a parse of the block it lands
	// in, rather than one of the whole document. A new split is adopted during
	// render, which React restarts at once with it; the split of unchanged
	// content is the previous one, so that restart parses nothing.
	const [previous, setPrevious] = useState<MarkdownBlocks>();
	const split = MarkdownUtils.split({ content, previous });
	if (split !== previous) setPrevious(split);

	return useMemo(() => {
		const last = split.blocks.length - 1;
		if (!streaming || last < 0) return split.blocks;

		return [...split.blocks.slice(0, last), remend(split.blocks[last])];
	}, [split, streaming]);
};
