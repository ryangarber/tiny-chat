import { useRef, useState } from "react";
import type {
	FindAdapter,
	FindHit,
	FindOptions,
} from "#client/features/find/types/find.ts";
import { FindUtils } from "#client/features/find/utils/FindUtils.ts";

/** An index kept within a list that may have shrunk under it. */
const clamp = (index: number, list: unknown[]) =>
	Math.max(0, Math.min(index, list.length - 1));

/**
 * Find in page, the same in the app and the CLI: the query, its hits, and the
 * one of them that is current, stepped through forward and back with
 * wraparound the way a browser's find bar steps.
 *
 * The runtime hands over what it holds through `adapter`, a segment at a time:
 * the text it draws of each, or the segment's data where it does not draw all
 * of it. Hits come back in the runtime's own nodes to highlight, for what is
 * drawn; stepping onto one that is not has the runtime draw it first. It calls
 * `refresh` whenever what it draws changes under an open bar.
 */
export function useFind<N>(adapter: FindAdapter<N>, options?: FindOptions) {
	const [isOpen, setOpen] = useState(false);
	const [query, setQueryState] = useState("");
	const [hits, setHits] = useState<FindHit<N>[]>([]);
	const [index, setIndex] = useState(0);

	// Read by `refresh`, which content changing calls from outside any render.
	const queryRef = useRef("");
	const hitsRef = useRef<FindHit<N>[]>([]);
	const indexRef = useRef(0);
	// Bumped by every selection: a segment drawn late is only gone to while
	// it is still the one wanted.
	const selectionRef = useRef(0);

	const commit = (found: FindHit<N>[], current: number) => {
		hitsRef.current = found;
		indexRef.current = current;
		setHits(found);
		setIndex(current);
	};

	const find = (query: string) =>
		FindUtils.hits(adapter.segments(), query, options);

	const select = (found: FindHit<N>[], current: number) => {
		commit(found, current);
		const hit = found[current];
		const selection = ++selectionRef.current;
		if (!hit) return;
		if (hit.match || !adapter.show) {
			if (hit.match) adapter.reveal?.(hit.match, hit.key);
			return;
		}
		void adapter.show(hit.key).then(() => {
			if (selection !== selectionRef.current) return;
			const again = find(queryRef.current);
			const at = FindUtils.locate(again, hit);
			const next = at === -1 ? clamp(indexRef.current, again) : at;
			commit(again, next);
			const shown = again[next];
			if (shown?.match) adapter.reveal?.(shown.match, shown.key);
		});
	};

	const setQuery = (value: string) => {
		queryRef.current = value;
		setQueryState(value);
		select(find(value), 0);
	};

	/** Steps to the next hit, or the previous with -1, wrapping at either end. */
	const step = (direction: 1 | -1) => {
		const found = hitsRef.current;
		if (!found.length) return;
		select(found, (indexRef.current + direction + found.length) % found.length);
	};

	/**
	 * Searches again for the same query, after what is drawn changed. The
	 * current hit keeps its place without being scrolled back to, so content
	 * arriving does not pull the view along with it; and nothing re-renders
	 * when the same hits are found again.
	 */
	const refresh = () => {
		if (!queryRef.current) return;
		const found = find(queryRef.current);
		const previous = hitsRef.current;
		if (
			found.length === previous.length &&
			found.every((hit, i) => FindUtils.isSameHit(hit, previous[i]))
		)
			return;
		const current = previous[indexRef.current];
		const at = current ? FindUtils.locate(found, current) : -1;
		commit(found, at === -1 ? clamp(indexRef.current, found) : at);
	};

	/** Opens the bar, finding the query it was closed with again. */
	const open = () => {
		setOpen(true);
		if (!queryRef.current) return;
		const found = find(queryRef.current);
		select(found, clamp(indexRef.current, found));
	};

	/** Closes the bar and clears its hits, keeping the query for next time. */
	const close = () => {
		setOpen(false);
		selectionRef.current++;
		commit([], 0);
	};

	const current = hits[index] as FindHit<N> | undefined;
	return {
		isOpen,
		open,
		close,
		query,
		setQuery,
		hits,
		/** The current hit's place in `hits`. */
		index,
		current,
		next: () => step(1),
		previous: () => step(-1),
		refresh,
		/** Searches the same query from the first hit, as after the scope changes. */
		restart: () => select(find(queryRef.current), 0),
		/** `3/12` while there are hits, `0/0` for a query without any. */
		label: query ? `${hits.length ? index + 1 : 0}/${hits.length}` : undefined,
	};
}
