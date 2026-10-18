import type { Editor } from "@tiptap/react";
import { type RefObject, useEffect } from "react";

/** How far a touch travels before it counts as a swipe. */
const SLOP = 8;
/** How far a swipe goes before it opens or closes the keyboard. */
const DISTANCE = 24;

/**
 * Whether the touch began in something that scrolls itself in the swipe's
 * direction, like a long draft, which keeps the drag to scroll through it.
 */
function claimsDrag(target: Element, root: Element, dy: number) {
	for (
		let element: Element | null = target;
		element && element !== root.parentElement;
		element = element.parentElement
	) {
		const style = getComputedStyle(element);
		if (
			(style.overflowY === "auto" || style.overflowY === "scroll") &&
			element.scrollHeight > element.clientHeight + 1
		) {
			const canScroll =
				dy > 0
					? element.scrollTop > 0
					: element.scrollTop + element.clientHeight < element.scrollHeight - 1;
			if (canScroll) return true;
		}
	}
	return false;
}

/**
 * Swiping up on the composer opens the keyboard, and swiping down puts it
 * away. The keyboard only opens from a focus during the touch's end, which
 * counts as the user's own action; it closes as soon as the swipe goes far
 * enough.
 */
export function useComposerSwipe({
	ref,
	editor,
}: {
	ref: RefObject<HTMLElement | null>;
	editor: Editor;
}) {
	useEffect(() => {
		const root = ref.current;
		if (!root) return;

		let swipe: {
			x: number;
			y: number;
			target: Element;
			locked: boolean;
			done: boolean;
		} | null = null;

		const onTouchStart = (event: TouchEvent) => {
			swipe = null;
			if (event.touches.length !== 1 || !(event.target instanceof Element))
				return;
			const touch = event.touches[0];
			swipe = {
				x: touch.clientX,
				y: touch.clientY,
				target: event.target,
				locked: false,
				done: false,
			};
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!swipe) return;
			if (event.touches.length !== 1) {
				swipe = null;
				return;
			}
			const touch = event.touches[0];
			const dx = touch.clientX - swipe.x;
			const dy = touch.clientY - swipe.y;

			if (!swipe.locked) {
				if (Math.hypot(dx, dy) < SLOP) return;
				// A sideways move belongs to the panels, or to whatever it began on.
				if (
					Math.abs(dy) < Math.abs(dx) * 1.2 ||
					!event.cancelable ||
					claimsDrag(swipe.target, root, dy)
				) {
					swipe = null;
					return;
				}
				swipe.locked = true;
			}

			// Keep the page from bouncing under the finger.
			event.preventDefault();
			if (!swipe.done && dy > DISTANCE && editor.isFocused) {
				swipe.done = true;
				editor.commands.blur();
			}
		};

		const onTouchEnd = (event: TouchEvent) => {
			const current = swipe;
			swipe = null;
			if (!current?.locked || current.done) return;
			const touch = event.changedTouches[0];
			if (!touch) return;
			if (
				current.y - touch.clientY > DISTANCE &&
				!editor.isFocused &&
				editor.isEditable
			)
				editor.commands.focus();
		};

		const onTouchCancel = () => {
			swipe = null;
		};

		root.addEventListener("touchstart", onTouchStart, { passive: true });
		root.addEventListener("touchmove", onTouchMove, { passive: false });
		root.addEventListener("touchend", onTouchEnd);
		root.addEventListener("touchcancel", onTouchCancel);
		return () => {
			root.removeEventListener("touchstart", onTouchStart);
			root.removeEventListener("touchmove", onTouchMove);
			root.removeEventListener("touchend", onTouchEnd);
			root.removeEventListener("touchcancel", onTouchCancel);
		};
	}, [ref, editor]);
}
