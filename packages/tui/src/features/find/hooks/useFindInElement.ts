import type { DOMElement } from "ink";
import { type RefObject, useEffect, useEffectEvent, useState } from "react";
import { useFindInScope } from "#client/features/find/hooks/useFindInScope.ts";
import type { FindHit } from "#client/features/find/types/find.ts";
import {
	type FindHighlight,
	FindLayoutUtils,
} from "#tui/features/find/utils/FindLayoutUtils.ts";

/**
 * How often an open bar looks again at what is drawn. Ink has nothing like a
 * mutation observer, so content arriving and views scrolling are caught by
 * looking, which costs a frame only when something did change.
 */
const POLL_INTERVAL = 100;

const isSame = (a: FindHighlight[], b: FindHighlight[]) =>
	a.length === b.length &&
	a.every(
		(highlight, i) =>
			highlight.x === b[i].x &&
			highlight.y === b[i].y &&
			highlight.text === b[i].text &&
			highlight.current === b[i].current,
	);

/**
 * Find in page over a registered scope, as Ink draws it under `targetRef`.
 * What is drawn comes back as `highlights`: rows of cells to draw over,
 * relative to `targetRef`, since a terminal has nothing to paint text in place
 * with. What the scope does not draw is searched from its data, and drawn as
 * it is stepped onto.
 *
 * Text under any of `skipRefs` — the bar itself, and the highlights — is
 * never matched.
 */
export function useFindInElement({
	targetRef,
	skipRefs = [],
}: {
	targetRef: RefObject<DOMElement | null>;
	skipRefs?: RefObject<DOMElement | null>[];
}) {
	const find = useFindInScope<DOMElement>({
		blocksOf: (node) =>
			FindLayoutUtils.blocks(
				node,
				skipRefs.map((ref) => ref.current),
			),
		reveal: FindLayoutUtils.reveal,
	});
	const { isOpen, hits, index } = find;

	const [highlights, setHighlights] = useState<FindHighlight[]>([]);

	// Read from the layout Ink computed for the last frame, which is only there
	// once that frame is committed.
	const measure = useEffectEvent(
		(isOpen: boolean, hits: FindHit<DOMElement>[], index: number) => {
			const root = targetRef.current;
			const drawn = hits.flatMap((hit, i) =>
				hit.match ? [{ match: hit.match, current: i === index }] : [],
			);
			const next =
				root && isOpen
					? FindLayoutUtils.highlights(
							root,
							drawn.map(({ match }) => match),
							drawn.findIndex(({ current }) => current),
						)
					: [];
			setHighlights((previous) => (isSame(previous, next) ? previous : next));
		},
	);

	useEffect(() => {
		measure(isOpen, hits, index);
	}, [isOpen, hits, index]);

	const refresh = useEffectEvent(() => find.refresh());
	const remeasure = useEffectEvent(() =>
		measure(find.isOpen, find.hits, find.index),
	);
	useEffect(() => {
		if (!isOpen) return;
		const interval = setInterval(() => {
			refresh();
			remeasure();
		}, POLL_INTERVAL);
		return () => clearInterval(interval);
	}, [isOpen]);

	return { ...find, highlights };
}
