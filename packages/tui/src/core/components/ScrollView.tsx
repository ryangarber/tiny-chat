import {
	type DOMElement,
	measureElement,
	useBoxMetrics,
	useInput,
	useWindowSize,
} from "ink";
import {
	Children,
	createContext,
	isValidElement,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import { useMouse } from "#tui/core/hooks/useMouse.ts";
import { useWidth } from "#tui/core/hooks/useWidth.ts";
import { type MouseEvent, MouseUtils } from "#tui/core/utils/MouseUtils.ts";

/** Where a child comes to rest when the view scrolls to it. */
export type ScrollAlign =
	/** Moves by the least amount that brings the child fully into view. */
	"auto" | "top" | "bottom" | "center";

interface ScrollViewRef {
	/** Rows between the top of the content and the top of the viewport. */
	getScrollOffset: () => number;
	getContentHeight: () => number;
	getViewportHeight: () => number;
	/** The offset at which the last row of content sits on the last row of the viewport. */
	getMaxOffset: () => number;
	/** Where a child sits within the content, or null if there is no such child. */
	getItemPosition: (index: number) => { top: number; height: number } | null;
	isAtTop: () => boolean;
	isAtBottom: () => boolean;
	scrollTo: (offset: number) => void;
	scrollBy: (delta: number) => void;
	scrollToTop: () => void;
	scrollToBottom: () => void;
	scrollToIndex: (index: number, align?: ScrollAlign) => void;
}

export interface ScrollViewProps extends Omit<BoxProps, "overflow"> {
	ref?: RefObject<ScrollViewRef | null>;
	children?: ReactNode;

	/**
	 * Child the view keeps visible. It scrolls only once the child would fall
	 * outside the viewport, and only by the rows that takes.
	 */
	selectedIndex?: number;
	/** @default "auto" */
	align?: ScrollAlign;

	/**
	 * Holds the view on the newest content while it is already resting there,
	 * and lets go the moment the reader scrolls away from it.
	 */
	stickToBottom?: boolean;
	/** Returns the view to its resting position whenever this changes. */
	resetKey?: string | null;

	/** @default true */
	wheel?: boolean;
	/** Rows a single turn of the wheel moves. @default 3 */
	wheelStep?: number;
	/**
	 * Takes PageUp and PageDown (Fn+↑↓ on a Mac), each moving a viewport less
	 * the two rows kept for context. For the one view that has the keys.
	 * @default false
	 */
	paging?: boolean;

	onScroll?: (offset: number) => void;
	/** Called while the viewport rests within {@link edgeThreshold} of the top. */
	onReachTop?: () => void;
	/** Called while the viewport rests within {@link edgeThreshold} of the bottom. */
	onReachBottom?: () => void;
	/** Rows from an edge that still count as having reached it. @default 0 */
	edgeThreshold?: number;

	/**
	 * Rows beyond each edge of the viewport whose children are mounted.
	 * Everything past them is unmounted and held at the height it was last
	 * measured at, or an estimate if it never was. `Infinity` mounts the whole
	 * list. @default 40
	 */
	overscan?: number;
}

/**
 * Moves a view by a wheel event if it can, returning whether it did. Views
 * register with the view they sit in, which hands the wheel on to them first.
 */
type WheelHandler = (event: MouseEvent) => boolean;
const ScrollContext = createContext<Set<WheelHandler> | null>(null);

/**
 * Each view's viewport, by which a row anywhere inside it is scrolled to,
 * returning the row it is then drawn at.
 */
const revealers = new WeakMap<DOMElement, (y: number) => number>();

/**
 * Scrolls every view holding `node` until row `y` of the layout — as
 * `measureElement` places rows — is in sight, centering it in each it was
 * not: the innermost first, then each around it, which brings the row as the
 * inner one now draws it into sight.
 */
export const revealRow = (node: DOMElement, y: number) => {
	let row = y;
	for (let parent = node.parentNode; parent; parent = parent.parentNode) {
		const reveal = revealers.get(parent);
		if (reveal) row = reveal(row);
	}
};

const height = (node: DOMElement | null) =>
	node?.yogaNode?.getComputedHeight() ?? 0;

/**
 * The height each child was last measured at, and what a child never laid out
 * is held at: the average of those that were.
 */
const held = (heights: ReadonlyMap<string, number>, keys: string[]) => {
	let total = 0;
	for (const value of heights.values()) total += value;
	return {
		measured: keys.map((key) => heights.get(key)),
		fallback: heights.size ? Math.max(1, Math.round(total / heights.size)) : 1,
	};
};

/** Rows a page moves through a viewport: all of it but two kept for context. */
export const pageRows = (viewport: number) => Math.max(1, viewport - 2);

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), Math.max(min, max));

/**
 * A viewport onto content taller than itself.
 *
 * Scrolling is a single number — the rows of content hidden above the viewport —
 * and every position it is set to is one the reader asked for: a wheel turn
 * moves by its own rows, a selection moves by the rows it takes to come back
 * into view, and nothing else moves the view on its own.
 *
 * Heights are read from the layout Ink has just computed rather than cached, so
 * a child that grows on its own — a streaming message, a tool call being
 * expanded — is accounted for without having to announce itself.
 *
 * Only the children near the viewport are mounted. The rest are replaced by a
 * box holding the height they were last measured at — or, for one never drawn,
 * the average of those that were — which keeps every position this view works
 * in what it would have been had the whole list been drawn, while costing a
 * single node and nothing at all to render. A list opened at its bottom mounts
 * only what fills the bottom, however long it is. Anything a child needs to
 * survive being scrolled away from, it keeps outside itself.
 */
export default function ScrollView({
	ref,
	children,
	selectedIndex,
	align = "auto",
	stickToBottom = false,
	resetKey,
	wheel = true,
	wheelStep = 3,
	paging = false,
	onScroll,
	onReachTop,
	onReachBottom,
	edgeThreshold = 0,
	overscan = 40,
	...props
}: ScrollViewProps) {
	const { rows } = useWindowSize();
	// Heights are only good for the width they were measured at, which is the
	// column this view sits in rather than the whole terminal.
	const columns = useWidth();

	const viewportRef = useRef<DOMElement | null>(null);
	const contentRef = useRef<DOMElement | null>(null);
	const itemsRef = useRef<(DOMElement | null)[]>([]);

	// Rendered through state, tracked through a ref: a wheel turn has to read the
	// offset it is moving from before React has committed the last one.
	const [offset, setOffsetState] = useState(0);
	const offsetRef = useRef(0);

	// While pinned the content is laid out against the bottom of the viewport
	// instead of an offset, so content that grows stays in view for free — no
	// measurement, and no frame spent catching up to it.
	const [pinned, setPinnedState] = useState(stickToBottom);
	const pinnedRef = useRef(stickToBottom);

	// Measured from the children rather than the box holding them: that box is
	// floored at the height of the viewport so short content still starts at the
	// top, which would otherwise report every list shorter than the viewport as
	// the same height and hide the fact that one of them had grown.
	const getContentHeight = useCallback(() => {
		for (let index = itemsRef.current.length - 1; index >= 0; index--) {
			const node = itemsRef.current[index];
			if (node?.yogaNode) return node.yogaNode.getComputedTop() + height(node);
		}
		return 0;
	}, []);
	const getViewportHeight = useCallback(() => height(viewportRef.current), []);
	const getMaxOffset = useCallback(
		() => Math.max(0, getContentHeight() - getViewportHeight()),
		[getContentHeight, getViewportHeight],
	);

	const getScrollOffset = useCallback(
		() =>
			pinnedRef.current
				? getMaxOffset()
				: Math.min(offsetRef.current, getMaxOffset()),
		[getMaxOffset],
	);

	const getItemPosition = useCallback((index: number) => {
		const node = itemsRef.current[index];
		if (!node?.yogaNode) return null;
		return { top: node.yogaNode.getComputedTop(), height: height(node) };
	}, []);

	const scrollTo = useCallback(
		(next: number) => {
			const max = getMaxOffset();
			const target = clamp(next, 0, max);
			// Reaching the bottom is what re-engages sticking to it, so following
			// the newest content is never something the reader has to ask for twice.
			const isPinned = stickToBottom && target >= max;

			if (target === offsetRef.current && isPinned === pinnedRef.current)
				return;

			offsetRef.current = target;
			pinnedRef.current = isPinned;
			setOffsetState(target);
			setPinnedState(isPinned);
			onScroll?.(target);
		},
		[getMaxOffset, stickToBottom, onScroll],
	);

	const scrollBy = useCallback(
		(delta: number) => scrollTo(getScrollOffset() + delta),
		[scrollTo, getScrollOffset],
	);

	const scrollToIndex = useCallback(
		(index: number, mode?: ScrollAlign) => {
			const to = mode ?? align;
			const position = getItemPosition(index);
			if (!position) return;

			const viewport = getViewportHeight();
			const current = getScrollOffset();
			const bottom = position.top + position.height - viewport;

			if (to === "top") return scrollTo(position.top);
			if (to === "bottom") return scrollTo(bottom);
			if (to === "center")
				return scrollTo(position.top + (position.height - viewport) / 2);

			// Anything already in view stays exactly where it is. A child taller than
			// the viewport is met at its top rather than scrolled through.
			if (position.top < current) return scrollTo(position.top);
			if (position.top + position.height > current + viewport)
				return scrollTo(Math.min(position.top, bottom));
		},
		[align, getItemPosition, getViewportHeight, getScrollOffset, scrollTo],
	);

	useImperativeHandle(
		ref,
		() => ({
			getScrollOffset,
			getContentHeight,
			getViewportHeight,
			getMaxOffset,
			getItemPosition,
			isAtTop: () => getScrollOffset() <= 0,
			isAtBottom: () => getScrollOffset() >= getMaxOffset(),
			scrollTo,
			scrollBy,
			scrollToTop: () => scrollTo(0),
			scrollToBottom: () => scrollTo(getMaxOffset()),
			scrollToIndex,
		}),
		[
			getScrollOffset,
			getContentHeight,
			getViewportHeight,
			getMaxOffset,
			getItemPosition,
			scrollTo,
			scrollBy,
			scrollToIndex,
		],
	);

	useEffect(() => {
		const node = viewportRef.current;
		if (!node) return;
		revealers.set(node, (y) => {
			const top = measureElement(node).y;
			const rows = getViewportHeight();
			if (y >= top && y < top + rows) return y;
			const before = getScrollOffset();
			scrollBy(y - top - Math.floor(rows / 2));
			// Where the scroll left it, which may fall short at either end.
			return y - (getScrollOffset() - before);
		});
		return () => {
			revealers.delete(node);
		};
	}, [getViewportHeight, getScrollOffset, scrollBy]);

	// Views nested in this one, offered the wheel before it.
	const [nested] = useState(() => new Set<WheelHandler>());
	const parent = useContext(ScrollContext);

	// The wheel turns over whatever the pointer is resting on, so views sitting
	// side by side — a transcript under a list of completions — each answer for
	// themselves without either having to be focused first. Like a browser, a
	// nested view takes the wheel until it reaches the edge it is being turned
	// towards, and only then does the view around it move. Only the outermost
	// view listens, so rows of a nested view scrolled out of sight never move it.
	const handleWheel = useCallback(
		(event: MouseEvent) => {
			if (!wheel) return false;
			const node = viewportRef.current;
			if (!node || MouseUtils.isCovered(node, event, rows)) return false;
			if (!MouseUtils.contains(MouseUtils.bounds(node, rows), event))
				return false;
			for (const handler of nested) if (handler(event)) return true;

			const current = getScrollOffset();
			if (event.deltaY < 0 ? current <= 0 : current >= getMaxOffset())
				return false;
			scrollBy(event.deltaY * wheelStep);
			return true;
		},
		[wheel, rows, nested, getScrollOffset, getMaxOffset, scrollBy, wheelStep],
	);

	useEffect(() => {
		if (!parent) return;
		parent.add(handleWheel);
		return () => {
			parent.delete(handleWheel);
		};
	}, [parent, handleWheel]);

	useMouse({
		handler: (event) => {
			if (event.type === "wheel" && event.deltaY !== 0) handleWheel(event);
		},
		isActive: wheel && !parent,
	});

	useInput(
		(_input, key) => {
			if (!key.pageUp && !key.pageDown) return;
			const page = pageRows(getViewportHeight());
			scrollBy(key.pageUp ? -page : page);
		},
		{ isActive: paging },
	);

	const items = useMemo(() => Children.toArray(children), [children]);

	// Identity of the children, which heights and the drawn run are held by.
	const keys = useMemo(
		() =>
			items.map((child, index) =>
				isValidElement(child) ? String(child.key ?? index) : String(index),
			),
		[items],
	);

	// The run of children that is drawn, held by key rather than by index so a
	// page arriving above the viewport keeps drawing the same children instead of
	// blanking the ones the indices used to name for a frame.
	const [drawn, setDrawn] = useState<{ first: string; last: string } | null>(
		null,
	);
	const heightsRef = useRef(new Map<string, number>());

	// The height each child was last measured at, read ahead of the next commit
	// rather than waiting a frame for state to deliver them, and what a child
	// never measured is held at in their place.
	// biome-ignore lint/nursery/useReactCompiler: layout measurements, which only exist outside of render.
	const { measured, fallback } = held(heightsRef.current, keys);

	// The run the pass below would settle on, worked out ahead of it from the
	// heights it last measured. Ink paints a commit before its layout effects
	// run, so a run left for that pass to widen — children filtered anew, a
	// held run that no longer reaches the viewport — is a frame of blank rows
	// on screen before it is.
	const expected = (() => {
		if (!keys.length) return null;
		const heightAt = (index: number) => measured[index] ?? fallback;
		// The terminal's rows stand in for the viewport, which is never taller.
		const reach = rows + overscan;

		if (pinned) {
			let first = keys.length;
			let filled = 0;
			while (first > 0 && filled < reach) filled += heightAt(--first);
			return { first, last: keys.length - 1 };
		}

		const top = offset - overscan;
		const bottom = offset + reach;
		let position = 0;
		let first = -1;
		let last = -1;
		for (let index = 0; index < keys.length && position < bottom; index++) {
			const end = position + heightAt(index);
			if (end > top) {
				if (first < 0) first = index;
				last = index;
			}
			position = end;
		}
		return first < 0
			? { first: keys.length - 1, last: keys.length - 1 }
			: { first, last };
	})();

	const range = (() => {
		if (overscan === Number.POSITIVE_INFINITY || !expected) return null;
		const first = drawn ? keys.indexOf(drawn.first) : -1;
		const last = drawn ? keys.lastIndexOf(drawn.last) : -1;
		if (first < 0 || last < first) return expected;
		return {
			first: Math.min(first, expected.first),
			last: Math.max(last, expected.last),
		};
	})();

	const hidden = keys.map(
		(_, index) => !!range && (index < range.first || index > range.last),
	);

	const previousColumnsRef = useRef(columns);
	const previousResetKeyRef = useRef(resetKey);
	const previousSelectedRef = useRef<number | undefined>(undefined);
	const previousSelectedKeyRef = useRef<string | undefined>(undefined);
	const lastEdgeRef = useRef({ top: false, bottom: false, content: -1 });
	// The first child in view and where it sat in the content, so content above
	// it changing height — an estimate replaced by a measurement, a page of older
	// content arriving — leaves the rows being read where they are.
	const anchorRef = useRef<{ key: string; top: number } | null>(null);

	// Ink recomputes the whole layout before this runs, so every height read here
	// is the one about to be drawn.
	useLayoutEffect(() => {
		// Children that have gone leave their slots behind.
		itemsRef.current.length = items.length;

		// Every height is a height at a width. Once that width moves, none of them
		// describe anything, so the list goes back to being drawn whole and is
		// measured again from what it lays out to now.
		if (previousColumnsRef.current !== columns) {
			previousColumnsRef.current = columns;
			heightsRef.current.clear();
			anchorRef.current = null;
			setDrawn(null);
		} else {
			// Rebuilt rather than updated so children that have gone drop out of it.
			// A hidden child keeps the height it was hidden at — the one it is
			// currently laid out at is that same height handed back.
			const heights = new Map<string, number>();
			for (const [index, key] of keys.entries()) {
				const node = itemsRef.current[index];
				const measured = hidden[index]
					? heightsRef.current.get(key)
					: node?.yogaNode
						? height(node)
						: undefined;
				if (measured !== undefined) heights.set(key, measured);
			}
			heightsRef.current = heights;
		}

		if (previousResetKeyRef.current !== resetKey) {
			previousResetKeyRef.current = resetKey;
			lastEdgeRef.current = { top: false, bottom: false, content: -1 };
			scrollTo(stickToBottom ? getMaxOffset() : 0);
		} else if (anchorRef.current && !pinnedRef.current) {
			const anchor = anchorRef.current;
			const index = keys.indexOf(anchor.key);
			const position = index >= 0 ? getItemPosition(index) : null;
			if (position && position.top !== anchor.top)
				scrollTo(offsetRef.current + position.top - anchor.top);
		}

		// Content that shrank out from under the view — a tool call collapsing, a
		// page dropping out of the cache — would otherwise leave it resting on rows
		// that are no longer there.
		if (!pinnedRef.current && offsetRef.current > getMaxOffset())
			scrollTo(offsetRef.current);

		// Only a selection that actually moved reaches for the view. Re-asserting
		// it on every pass would take the view back off the reader the moment they
		// turned the wheel away from it, and again every time a page landed.
		const selectedKey =
			selectedIndex === undefined ? undefined : keys[selectedIndex];
		const moved =
			selectedIndex !== previousSelectedRef.current ||
			selectedKey !== previousSelectedKeyRef.current;
		previousSelectedRef.current = selectedIndex;
		previousSelectedKeyRef.current = selectedKey;

		if (moved && selectedIndex !== undefined && selectedIndex >= 0)
			scrollToIndex(selectedIndex);

		// Chosen against the offset the scrolling above has already settled on, so
		// a selection reached for on this pass is drawn on the next one rather than
		// arriving a frame after the view does.
		const viewport = getViewportHeight();
		if (viewport > 0 && overscan !== Number.POSITIVE_INFINITY) {
			const top = getScrollOffset() - overscan;
			const bottom = getScrollOffset() + viewport + overscan;

			// Every child has a box at its place, so the run is found by halving.
			const ends = (index: number) => {
				const position = getItemPosition(index);
				return position ? position.top + position.height : 0;
			};
			const starts = (index: number) => getItemPosition(index)?.top ?? 0;
			let low = 0;
			let high = items.length - 1;
			let first = -1;
			while (low <= high) {
				const middle = (low + high) >> 1;
				if (ends(middle) <= top) low = middle + 1;
				else {
					first = middle;
					high = middle - 1;
				}
			}
			let last = first;
			low = Math.max(first, 0);
			high = items.length - 1;
			while (first >= 0 && low <= high) {
				const middle = (low + high) >> 1;
				if (starts(middle) < bottom) {
					last = middle;
					low = middle + 1;
				} else high = middle - 1;
			}

			if (
				first >= 0 &&
				(keys[first] !== drawn?.first || keys[last] !== drawn?.last)
			)
				// biome-ignore lint/nursery/useReactCompiler: the run is measured from the layout Ink just computed, which only a layout effect can read.
				setDrawn({ first: keys[first], last: keys[last] });

			// Taken against the offset just settled on, for the next pass to hold.
			const current = getScrollOffset();
			low = 0;
			high = items.length - 1;
			let visible = -1;
			while (low <= high) {
				const middle = (low + high) >> 1;
				if (ends(middle) <= current) low = middle + 1;
				else {
					visible = middle;
					high = middle - 1;
				}
			}
			anchorRef.current =
				visible >= 0 ? { key: keys[visible], top: starts(visible) } : null;
		}

		// Nothing has been laid out yet, so any edge would be one every view is at.
		const content = getContentHeight();
		if (getViewportHeight() === 0 || content === 0) return;

		const current = getScrollOffset();
		const edge = {
			top: current <= edgeThreshold,
			bottom: getMaxOffset() - current <= edgeThreshold,
			content,
		};
		const last = lastEdgeRef.current;
		lastEdgeRef.current = edge;

		// Resting against an edge only counts once, until either the reader leaves
		// it or the content that arrived leaves the view still resting there.
		if (edge.top && (!last.top || last.content !== content)) onReachTop?.();
		if (edge.bottom && (!last.bottom || last.content !== content))
			onReachBottom?.();
	});

	// Re-runs the effect above whenever anything under the view changes shape,
	// including a child that re-rendered without the view itself re-rendering.
	useBoxMetrics(contentRef);

	return (
		// Sizing and spacing are the caller's, and are kept off the viewport so the
		// height measured for it is the height content is actually shown through.
		<Box flexDirection="column" {...props}>
			<Box
				ref={viewportRef}
				// Overflowing content is laid out past the edges of this box and
				// clipped to it, which is what makes it a viewport rather than a list.
				overflow="hidden"
				flexDirection="column"
				flexGrow={1}
				flexShrink={1}
				minHeight={0}
				justifyContent={pinned ? "flex-end" : "flex-start"}
			>
				<ScrollContext value={nested}>
					<Box
						ref={contentRef}
						flexDirection="column"
						// Never shrinks, so it keeps the full height of its children and
						// overflows the viewport rather than being squeezed into it.
						flexShrink={0}
						// While pinned, content shorter than the viewport would hang off the
						// bottom it is laid out against, so it grows into whatever room the
						// viewport has left to bring it back to the top. Grown rather than
						// floored at a percentage: a percentage resolves against the height a
						// view has been offered rather than the one it settles at, so a view
						// free to size itself to its content — one bounded only by a
						// maxHeight — would be held open at that bound by content that never
						// filled it, where growing only ever fills room that is really there.
						flexGrow={pinned ? 1 : 0}
						marginTop={pinned ? 0 : -offset}
					>
						{items.map((child, index) => (
							<Box
								// Keyed by the child so a page arriving above the viewport moves
								// the wrappers along with it instead of remounting every child
								// into a new position.
								key={keys[index]}
								ref={(node) => {
									itemsRef.current[index] = node;
								}}
								flexShrink={0}
								flexDirection="column"
								// Stands in for the child while it is hidden, so the rows it
								// takes up are still there to be scrolled through and measured.
								height={
									hidden[index] ? (measured[index] ?? fallback) : undefined
								}
							>
								{!hidden[index] && child}
							</Box>
						))}
					</Box>
				</ScrollContext>
			</Box>
		</Box>
	);
}
