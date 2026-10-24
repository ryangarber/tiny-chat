import type { DOMElement } from "ink";
import type { FindBlock, FindMatch } from "#client/features/find/types/find.ts";
import { revealRow } from "#tui/core/components/ScrollView.tsx";
import {
	TextLayoutUtils,
	type TextRow,
} from "#tui/core/utils/TextLayoutUtils.ts";

/** A row of a match as drawn, placed in cells from the searched element's content. */
export interface FindHighlight extends TextRow {
	current: boolean;
}

export const FindLayoutUtils = {
	/**
	 * Every block of text drawn under `root` — each `<Text>` holding inline
	 * text nested in it — skipping what is hidden and whatever is under `skip`.
	 */
	*blocks(
		root: DOMElement,
		skip: (DOMElement | null)[] = [],
	): Generator<FindBlock<DOMElement>> {
		for (const node of TextLayoutUtils.blocks(root, skip)) {
			const text = TextLayoutUtils.text(node);
			if (text) yield [{ node, text }];
		}
	},

	/**
	 * Where matches are drawn, row by row, relative to the content box of
	 * `root` — where a child of it positioned absolutely at the same offsets
	 * covers them. Rows a view has scrolled out of sight are left out.
	 */
	highlights: (
		root: DOMElement,
		matches: FindMatch<DOMElement>[],
		current: number,
	): FindHighlight[] => {
		const pieces = matches.flatMap((match, index) =>
			match.pieces.map((piece) => ({ ...piece, match: index })),
		);
		return TextLayoutUtils.rows(root, pieces).map(({ piece, ...row }) => ({
			...row,
			current: pieces[piece].match === current,
		}));
	},

	/** Scrolls whatever view holds a match until its first row is in sight. */
	reveal: (match: FindMatch<DOMElement>) => {
		const { node, offset } = match.start;
		const layout = TextLayoutUtils.layout(node);
		if (!layout) return;
		revealRow(node, layout.y + (layout.cells[offset]?.line ?? 0));
	},
} as const;
