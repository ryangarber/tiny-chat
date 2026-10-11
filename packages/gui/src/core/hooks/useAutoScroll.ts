import type { RefCallback } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";

const SCROLL_BOTTOM_THRESHOLD = 80;
const SCROLL_REENGAGE_THRESHOLD = 2;
const PROGRAMMATIC_SCROLL_GUARD_MS = 800;
/** Room left above a node scrolled to, clear of the faded top edge. */
const SCROLL_TO_NODE_MARGIN = 48;
/** Slack past a runtime keyboard's own duration for the page to follow it. */
const KEYBOARD_SETTLE_MS = 200;

/** A node inside the viewport plus where it sat relative to the viewport's top edge. */
interface ScrollAnchor {
	node: Element;
	offset: number;
}

/**
 * Manages autoscroll behavior for a vertically-scrolling container.
 *
 * Features:
 * - Tracks whether the container is at the bottom (via native scroll listener)
 * - Scrolls to the bottom on new content (if already at bottom)
 * - Disengages autoscroll on intentional upward scroll (wheel/touch)
 * - Holds the position the user picked when content above it changes
 * - Compensates for visual viewport resizes (mobile keyboard)
 * - Leaves the content in place under a runtime's keyboard, even at the bottom
 */
export function useAutoScroll() {
	const runtime = useRuntime();
	const viewportNodeRef = useRef<HTMLDivElement | null>(null);
	const isAtBottomRef = useRef(true);
	const isNearBottomRef = useRef(true);
	const scrollRafIdRef = useRef<number | null>(null);
	const scrollSessionRef = useRef(0);
	const suppressScrollDisengageUntilRef = useRef(0);
	const anchorRef = useRef<ScrollAnchor | null>(null);
	const desiredScrollTopRef = useRef(0);
	/**
	 * How far short of the bottom following it aims: the room a runtime's
	 * keyboard took from the viewport, which the content stays put for rather
	 * than scrolling away from, until it grows or the user scrolls into it.
	 */
	const keyboardHoldRef = useRef(0);
	const keyboardUntilRef = useRef(0);

	const [isAtBottom, setIsAtBottom] = useState(true);
	const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);

	const viewportRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
		if (viewportNodeRef.current === node) return;
		viewportNodeRef.current = node;
		setViewportEl(node);
	}, []);

	const getDistanceFromBottom = useCallback(() => {
		const el = viewportNodeRef.current;
		if (!el) return 0;
		return el.scrollHeight - el.scrollTop - el.clientHeight;
	}, []);

	const checkIsAtBottom = useCallback(
		(threshold = SCROLL_BOTTOM_THRESHOLD) => {
			return getDistanceFromBottom() <= threshold;
		},
		[getDistanceFromBottom],
	);

	const getMaxScrollTop = useCallback(() => {
		const el = viewportNodeRef.current;
		if (!el) return 0;
		return Math.max(0, el.scrollHeight - el.clientHeight);
	}, []);

	const syncNearBottomState = useCallback((nearBottom: boolean) => {
		if (isNearBottomRef.current !== nearBottom) {
			isNearBottomRef.current = nearBottom;
			setIsAtBottom(nearBottom);
		}
	}, []);

	/**
	 * Remember a node that is currently on screen so the same view can be
	 * reproduced after content above it is added, removed or re-rendered.
	 * The previous anchor is reused while it stays visible, which keeps this
	 * cheap enough to run on every scroll event.
	 */
	const captureAnchor = useCallback(() => {
		const el = viewportNodeRef.current;
		if (!el) return;

		const viewportTop = el.getBoundingClientRect().top;
		const viewportBottom = viewportTop + el.clientHeight;

		const anchor = anchorRef.current;
		if (anchor && el.contains(anchor.node)) {
			const rect = anchor.node.getBoundingClientRect();
			if (rect.bottom > viewportTop && rect.top < viewportBottom) {
				anchor.offset = rect.top - viewportTop;
				return;
			}
		}

		// Descend through wrappers (Mantine's ScrollArea adds a couple) until we
		// reach the element that actually holds the list.
		let list: Element = el;
		while (list.children.length === 1) list = list.children[0];

		// Topmost child that still reaches into the viewport.
		const children = list.children;
		let low = 0;
		let high = children.length - 1;
		let index = 0;
		while (low <= high) {
			const middle = (low + high) >> 1;
			if (children[middle].getBoundingClientRect().bottom <= viewportTop) {
				low = middle + 1;
				index = low;
			} else {
				high = middle - 1;
			}
		}

		const node = children.item(index);
		anchorRef.current = node
			? { node, offset: node.getBoundingClientRect().top - viewportTop }
			: null;
	}, []);

	/**
	 * Put the viewport back where the user left it after the content changed.
	 * Falls back to the raw offset when the anchor did not survive the update
	 * (a full list re-render, for example). While the content is still too short
	 * to honour the target the anchor is left untouched, so a later growth can
	 * finish the restore instead of settling for a clamped position.
	 */
	const restorePosition = useCallback(() => {
		const el = viewportNodeRef.current;
		if (!el) return;

		const anchor = anchorRef.current;
		let target = desiredScrollTopRef.current;
		if (anchor && el.contains(anchor.node)) {
			const viewportTop = el.getBoundingClientRect().top;
			const drift =
				anchor.node.getBoundingClientRect().top - viewportTop - anchor.offset;
			target = el.scrollTop + drift;
		}

		const next = Math.min(Math.max(target, 0), getMaxScrollTop());
		if (Math.abs(next - el.scrollTop) >= 0.5) el.scrollTop = next;

		if (Math.abs(next - target) < 1) {
			desiredScrollTopRef.current = next;
			captureAnchor();
		}
	}, [captureAnchor, getMaxScrollTop]);

	const cancelScrollLoop = useCallback(() => {
		scrollSessionRef.current += 1;
		if (scrollRafIdRef.current !== null) {
			cancelAnimationFrame(scrollRafIdRef.current);
			scrollRafIdRef.current = null;
		}
	}, []);

	const disengage = useCallback(() => {
		cancelScrollLoop();
		const el = viewportNodeRef.current;
		if (isAtBottomRef.current && el && el.scrollHeight > el.clientHeight + 1) {
			isAtBottomRef.current = false;
		}
		syncNearBottomState(checkIsAtBottom());
		captureAnchor();
	}, [cancelScrollLoop, captureAnchor, checkIsAtBottom, syncNearBottomState]);

	const animateScrollToBottom = useCallback(() => {
		const el = viewportNodeRef.current;
		if (!el) return;

		// Cancel any existing loop so we always have the freshest state
		cancelScrollLoop();
		const session = scrollSessionRef.current;
		let prevClientHeight = el.clientHeight;

		const step = () => {
			if (!isAtBottomRef.current || session !== scrollSessionRef.current) {
				scrollRafIdRef.current = null;
				return;
			}

			const resize = el.clientHeight - prevClientHeight;
			prevClientHeight = el.clientHeight;
			if (resize < 0 && performance.now() < keyboardUntilRef.current) {
				keyboardHoldRef.current -= resize;
			} else if (resize > 0) {
				keyboardHoldRef.current = Math.max(0, keyboardHoldRef.current - resize);
			}

			const currentTop = el.scrollTop;
			const bottom = el.scrollHeight - el.clientHeight;
			keyboardHoldRef.current = Math.min(
				keyboardHoldRef.current,
				Math.max(0, bottom - currentTop),
			);
			const targetTop = bottom - keyboardHoldRef.current;
			const diff = targetTop - currentTop;

			if (diff > 1) {
				const move = Math.max(Math.ceil(diff * 0.3), 2);
				el.scrollTop = Math.min(currentTop + move, targetTop);
			}
			// biome-ignore lint/nursery/useReactCompiler: step is a recursive callback-local function, not a hook dependency.
			scrollRafIdRef.current = requestAnimationFrame(step);
		};

		scrollRafIdRef.current = requestAnimationFrame(step);
	}, [cancelScrollLoop]);

	const scrollToBottom = useCallback(
		(behavior: ScrollBehavior = "instant") => {
			const el = viewportNodeRef.current;
			if (!el) return;

			isAtBottomRef.current = true;
			syncNearBottomState(true);
			// The bottom is the position to hold from here on, so anything we were
			// restoring towards is obsolete.
			anchorRef.current = null;
			keyboardHoldRef.current = 0;
			desiredScrollTopRef.current = getMaxScrollTop();
			suppressScrollDisengageUntilRef.current =
				performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS;

			if (behavior === "smooth") {
				animateScrollToBottom();
			} else {
				// Cancel any running animation, then jump instantly
				cancelScrollLoop();
				el.scrollTop = el.scrollHeight;
				// Restart the loop so we stay locked if content keeps growing
				animateScrollToBottom();
			}
		},
		[
			animateScrollToBottom,
			cancelScrollLoop,
			getMaxScrollTop,
			syncNearBottomState,
		],
	);

	/**
	 * Bring a node to the top of the viewport and hold it there, letting go of
	 * the bottom the same way scrolling up to it would.
	 */
	const scrollToNode = useCallback(
		(node: Element, behavior: ScrollBehavior = "smooth") => {
			const el = viewportNodeRef.current;
			if (!el?.contains(node)) return;

			cancelScrollLoop();
			isAtBottomRef.current = false;
			suppressScrollDisengageUntilRef.current = 0;

			const viewportTop = el.getBoundingClientRect().top;
			const target =
				el.scrollTop +
				node.getBoundingClientRect().top -
				viewportTop -
				SCROLL_TO_NODE_MARGIN;
			const next = Math.min(Math.max(target, 0), getMaxScrollTop());
			desiredScrollTopRef.current = next;
			anchorRef.current = {
				node,
				offset: SCROLL_TO_NODE_MARGIN - (target - next),
			};
			el.scrollTo({ top: next, behavior });
			syncNearBottomState(next >= getMaxScrollTop() - SCROLL_BOTTOM_THRESHOLD);
		},
		[cancelScrollLoop, getMaxScrollTop, syncNearBottomState],
	);

	// Native scroll listener tracking manual upward scrolls
	useEffect(() => {
		const el = viewportEl;
		if (!el) return;

		let prevScrollTop = el.scrollTop;

		const onScroll = () => {
			// Content that shrinks drags scrollTop down with it. That is the browser
			// clamping the viewport rather than the user moving it, so ignore the
			// event completely and keep holding the position we are restoring to.
			const max = Math.max(0, el.scrollHeight - el.clientHeight);
			if (desiredScrollTopRef.current > max + 1 && el.scrollTop >= max - 1) {
				return;
			}

			const currentScrollTop = el.scrollTop;
			const isScrollingUp = currentScrollTop < prevScrollTop;
			prevScrollTop = currentScrollTop;
			desiredScrollTopRef.current = currentScrollTop;

			const nearBottom = checkIsAtBottom();
			const atBottom = checkIsAtBottom(SCROLL_REENGAGE_THRESHOLD);
			const suppressDisengage =
				performance.now() < suppressScrollDisengageUntilRef.current &&
				isAtBottomRef.current;

			syncNearBottomState(nearBottom);

			// Upward scroll ALWAYS disengages, even within the 80px threshold.
			// This prevents the loop from fighting the user's scroll-up gesture.
			if (isScrollingUp && !suppressDisengage) {
				disengage();
			} else if (atBottom && !isAtBottomRef.current) {
				// Only re-engage when scrolling DOWN and actually reaching the bottom.
				// Using the looser "near bottom" threshold here can immediately undo a
				// user's small upward scroll and make the viewport feel sticky.
				isAtBottomRef.current = true;
			}

			if (atBottom) {
				suppressScrollDisengageUntilRef.current = 0;
			}

			if (!isAtBottomRef.current) captureAnchor();
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [
		viewportEl,
		captureAnchor,
		checkIsAtBottom,
		disengage,
		syncNearBottomState,
	]);

	useEffect(
		() =>
			runtime.onKeyboard?.(({ duration }) => {
				keyboardUntilRef.current =
					performance.now() + duration * 1000 + KEYBOARD_SETTLE_MS;
			}),
		[runtime],
	);

	// Compensate for visual viewport resizing
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;

		let prevHeight = vv.height;

		const onResize = () => {
			const el = viewportNodeRef.current;
			if (!el) return;

			const newHeight = vv.height;
			const delta = prevHeight - newHeight;
			prevHeight = newHeight;

			if (Math.abs(delta) < 1) return;

			if (isAtBottomRef.current) el.scrollTop = el.scrollHeight;
			else if (delta > 0) el.scrollTop += delta;
		};

		vv.addEventListener("resize", onResize);
		return () => vv.removeEventListener("resize", onResize);
	}, []);

	// Gesture listeners to immediately engage manual scroll handling
	useEffect(() => {
		const el = viewportEl;
		if (!el) return;

		// A real gesture outranks a restore that is still pending because the
		// content has not grown back yet: the user's new position wins.
		const takeOver = () => {
			if (desiredScrollTopRef.current > getMaxScrollTop()) {
				desiredScrollTopRef.current = el.scrollTop;
				anchorRef.current = null;
			}
		};

		const onWheel = (e: WheelEvent) => {
			takeOver();
			if (e.deltaY < 0) {
				suppressScrollDisengageUntilRef.current = 0;
				disengage();
			}
		};

		let touchStartY = 0;
		const onTouchStart = (e: TouchEvent) => {
			touchStartY = e.touches[0].clientY;
		};
		const onTouchMove = (e: TouchEvent) => {
			takeOver();
			const deltaY = touchStartY - e.touches[0].clientY;
			if (deltaY < 0) {
				suppressScrollDisengageUntilRef.current = 0;
				disengage();
			}
		};

		el.addEventListener("wheel", onWheel, { passive: true });
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchmove", onTouchMove, { passive: true });
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchmove", onTouchMove);
		};
	}, [viewportEl, disengage, getMaxScrollTop]);

	// React to content height changes: follow the bottom while locked, otherwise
	// hold the position the user picked.
	useEffect(() => {
		const el = viewportEl;
		if (!el) return;
		const contentEl = el.firstElementChild;
		if (!contentEl) return;

		let prevHeight = contentEl.scrollHeight;

		const observer = new ResizeObserver(() => {
			const newHeight = contentEl.scrollHeight;
			const delta = newHeight - prevHeight;
			prevHeight = newHeight;

			if (isAtBottomRef.current) {
				if (delta > 0) {
					// New content is worth uncovering.
					keyboardHoldRef.current = 0;
					syncNearBottomState(true);
					animateScrollToBottom();
				}
				return;
			}

			// Runs before paint, so pagination and re-renders never flash the
			// viewport at the wrong offset.
			restorePosition();
		});

		observer.observe(contentEl);
		return () => observer.disconnect();
	}, [viewportEl, animateScrollToBottom, restorePosition, syncNearBottomState]);

	/** Whether the view is following the bottom, as of right now. */
	const isLockedToBottom = useCallback(() => isAtBottomRef.current, []);

	return {
		viewportRef,
		isAtBottom,
		isLockedToBottom,
		scrollToBottom,
		scrollToNode,
	};
}
