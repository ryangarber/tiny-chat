import { type DOMElement, measureElement } from "ink";
import { type RefObject, useContext, useLayoutEffect, useState } from "react";
import {
	type ScrollViewport,
	ScrollViewportContext,
} from "#tui/core/components/ScrollView.tsx";

/** Yoga's `Edge.Top`, which Ink doesn't re-export. */
const EDGE_TOP = 1;

/**
 * Rows down from inside a block's border that something drawn over it sits at,
 * so it stays in sight while the block is scrolled through: `min` while its top
 * is shown, the first of its rows still shown once its top is scrolled away,
 * and never past `inset` rows from its bottom. Every view the block sits in
 * clips it, so the deepest any of them has scrolled past its top is what counts.
 *
 * Only a block its views have scrolled into draws anywhere but `min`, so of
 * all the blocks in a view only the one or two at its top ever re-render.
 */
export function useScrollSticky(
	ref: RefObject<DOMElement | null>,
	{ min = 0, inset = 0 }: { min?: number; inset?: number } = {},
) {
	const viewport = useContext(ScrollViewportContext);
	const [top, setTop] = useState(min);

	useLayoutEffect(() => {
		if (!viewport) return;
		const update = () => {
			const node = ref.current;
			if (!node?.yogaNode) return;
			const block = measureElement(node);
			let hidden = 0;
			for (
				let view: ScrollViewport | null = viewport;
				view;
				view = view.parent
			) {
				const viewNode = view.node();
				if (viewNode?.yogaNode)
					hidden = Math.max(hidden, measureElement(viewNode).y - block.y);
			}
			// An absolute child's `top` counts from inside the block's border,
			// where the rows scrolled past count from its outer edge.
			const border = node.yogaNode.getComputedBorder(EDGE_TOP);
			const max = Math.max(min, block.height - 2 * border - 1 - inset);
			setTop(Math.min(Math.max(min, hidden - border), max));
		};
		update();
		const unsubscribe: (() => void)[] = [];
		for (let view: ScrollViewport | null = viewport; view; view = view.parent)
			unsubscribe.push(view.subscribe(update));
		return () => {
			for (const stop of unsubscribe) stop();
		};
	}, [viewport, ref, min, inset]);

	return top;
}
