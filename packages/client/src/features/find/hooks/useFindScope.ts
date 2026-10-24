import {
	createContext,
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { FindScopeService } from "#client/features/find/services/FindScopeService.ts";
import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import type { FindSegment } from "#client/features/find/types/find.ts";

/** A segment something is drawn inside, in the scope that holds it. */
export interface FindSegmentRef {
	scope: string;
	key: string;
}

/** The scope something is drawn inside. */
export const FindScopeContext = createContext<string | null>(null);

/**
 * Every segment something is drawn inside, outermost first: one for each scope
 * around it, so that something hidden inside a block of code inside a message
 * keeps both from being searched as drawn.
 */
export const FindSegmentContext = createContext<FindSegmentRef[]>([]);

/**
 * Registers a part of the screen find can be scoped to, inside whichever scope
 * it is drawn in. A `segmented` scope is given its segments by something drawn
 * inside it, through `useFindSegments`; any other is searched as one segment
 * of whatever it draws, and is that segment to what it holds.
 *
 * Returns what to provide to `FindScopeContext` and `FindSegmentContext`.
 */
export const useFindScope = <N>({
	id,
	label,
	region = false,
	segmented = false,
	ref,
	text,
}: {
	id: string;
	label: string;
	region?: boolean;
	segmented?: boolean;
	ref: RefObject<N | null>;
	/** What it holds as text, for one that hides some of what it draws. */
	text?: () => string[];
}) => {
	const parent = useContext(FindScopeContext);
	const chain = useContext(FindSegmentContext);

	// Read as find searches, which is long after any render.
	const textRef = useRef(text);
	useLayoutEffect(() => {
		textRef.current = text;
	});

	useEffect(
		() =>
			FindScopeService.register(id, {
				parent: parent ?? undefined,
				label,
				region,
				segmented,
				node: () => ref.current,
				text: () => textRef.current?.() ?? [],
			}),
		[id, parent, label, region, segmented, ref],
	);

	// Unless it is given segments, all of it is one, drawn while it is.
	useEffect(() => {
		if (segmented) return;
		return FindScopeService.draw(id, id, () => ref.current);
	}, [id, ref, segmented]);

	const segmentChain = useMemo(
		() => (segmented ? chain : [...chain, { scope: id, key: id }]),
		[chain, id, segmented],
	);

	return { scope: id, segments: segmentChain };
};

/** Gives the segmented scope this is drawn in its segments, from data. */
export const useFindSegments = (segments: () => Iterable<FindSegment>) => {
	const scope = useContext(FindScopeContext);
	const segmentsRef = useRef(segments);
	useLayoutEffect(() => {
		segmentsRef.current = segments;
	});
	useEffect(() => {
		if (!scope) return;
		return FindScopeService.provide(scope, () => segmentsRef.current());
	}, [scope]);
};

/**
 * Marks something drawn as one of the segments its scope searches, under the
 * key the scope's data gives it. Anything inside a segment of the same scope
 * is part of that one instead, as a subagent's messages are part of its call.
 *
 * Returns what to provide to `FindSegmentContext`.
 */
export const useFindSegment = <N>(key: string, ref: RefObject<N | null>) => {
	const scope = useContext(FindScopeContext);
	const chain = useContext(FindSegmentContext);
	const nested = !scope || chain.some((segment) => segment.scope === scope);

	useEffect(() => {
		if (nested || !scope) return;
		return FindScopeService.draw(scope, key, () => ref.current);
	}, [nested, scope, key, ref]);

	return useMemo(
		() => (nested || !scope ? chain : [...chain, { scope, key }]),
		[nested, scope, key, chain],
	);
};

/**
 * For anything that hides some of what it draws — folds it shut, cuts it to
 * its last lines: while `hidden`, the segments around it are searched from
 * their data rather than from what is drawn.
 */
export const useFindHidden = (hidden: boolean) => {
	const chain = useContext(FindSegmentContext);
	useEffect(() => {
		if (!hidden) return;
		const shown = chain.map(({ scope, key }) =>
			FindScopeService.hide(scope, key),
		);
		return () => {
			for (const show of shown) show();
		};
	}, [hidden, chain]);
};

/**
 * Whether find is showing a match in a segment around this, so that whatever
 * hides some of it should stop.
 */
export const useFindRevealed = () => {
	const chain = useContext(FindSegmentContext);
	return useFindStore(
		(state) =>
			!!state.revealed &&
			chain.some(
				({ scope, key }) =>
					state.revealed?.scope === scope && state.revealed.key === key,
			),
	);
};

/**
 * `useFindHidden` and `useFindRevealed` together, for what hides some of what
 * it draws until find shows a match in it.
 */
export const useFindReveal = (hidden: boolean) => {
	useFindHidden(hidden);
	return useFindRevealed();
};

/**
 * Whether find is showing a match in one of `keys`, the segments of the scope
 * something is drawn in that it holds but hides — a folded run of tool calls.
 */
export const useFindRevealing = (keys: string[]) => {
	const scope = useContext(FindScopeContext);
	return useFindStore(
		(state) =>
			!!state.revealed &&
			state.revealed.scope === scope &&
			keys.includes(state.revealed.key),
	);
};
