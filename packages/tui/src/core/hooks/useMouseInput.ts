import type { DOMElement } from "ink";
import { useWindowSize } from "ink";
import { useCallback, useRef } from "react";
import { useMouse } from "#tui/core/hooks/useMouse.ts";
import {
	type MouseBounds,
	type MouseEvent,
	MouseUtils,
} from "#tui/core/utils/MouseUtils.ts";

/** Keeps a point the pointer left the element with inside of it. */
const clamp = (event: MouseEvent, bounds: MouseBounds): MouseEvent => ({
	...event,
	x: Math.min(Math.max(event.x - bounds.x, 0), Math.max(0, bounds.width - 1)),
	y: Math.min(Math.max(event.y - bounds.y, 0), Math.max(0, bounds.height - 1)),
});

/**
 * Subscribes to high-level mouse events for one or more elements.
 */
export const useMouseInput = ({
	onClick,
	onDrag,
	onDragEnd,
	onHoverStart,
	onHoverEnd,
	isActive = true,
}: {
	onClick?: (_: { index: number; event: MouseEvent }) => void;
	/** Called when the mouse pointer drags on the element. */
	onDrag?: (_: { index: number; event: MouseEvent }) => void;
	/** Called when the mouse pointer lets go of the element. */
	onDragEnd?: (_: { index: number; event: MouseEvent }) => void;
	/** Called when the mouse pointer enters the element. */
	onHoverStart?: (_: { index: number; event: MouseEvent }) => void;
	/** Called when the mouse pointer leaves the element. */
	onHoverEnd?: (_: { index: number; event: MouseEvent }) => void;
	isActive?: boolean;
} = {}) => {
	const { rows } = useWindowSize();

	const refs = useRef<DOMElement[]>([]);
	const mouseRef = useCallback((element: DOMElement | null, index?: number) => {
		index ??= 0;
		if (element) {
			refs.current[index] = element;
		} else {
			delete refs.current[index];
		}
	}, []);

	const hovers = useRef<Set<number>>(new Set());

	// The last point each drag reached, which a drag whose release never came is
	// ended on.
	const drags = useRef<Map<number, MouseEvent>>(new Map());

	useMouse({
		handler: (event) => {
			if (event.type === "wheel") return;

			for (let i = 0; i < refs.current.length; i++) {
				// Registering by index leaves holes behind when a row unmounts.
				const element = refs.current[i];
				if (!element) continue;

				const bounds = MouseUtils.bounds(element, rows);

				// A drag follows the pointer out of the element, held to its edge, and
				// ends wherever the button comes up. A release out past the terminal's
				// window may never be reported at all, which a move with no button
				// held, or a fresh press, gives away.
				const last = drags.current.get(i);
				if (last) {
					const isLost =
						event.type === "down" ||
						(event.type === "move" && event.button === "none");

					if (event.type === "up" || isLost) {
						drags.current.delete(i);
						onDragEnd?.({
							index: i,
							event: clamp(isLost ? last : event, bounds),
						});
					} else if (event.type === "move") {
						drags.current.set(i, event);
						onDrag?.({ index: i, event: clamp(event, bounds) });
					}
				}

				if (
					MouseUtils.contains(bounds, event) &&
					!MouseUtils.isCovered(element, event, rows)
				) {
					if (!hovers.current.has(i)) {
						hovers.current.add(i);
						onHoverStart?.({
							index: i,
							event: { ...event, x: event.x - bounds.x, y: event.y - bounds.y },
						});
					}
				} else {
					if (hovers.current.has(i)) {
						hovers.current.delete(i);
						onHoverEnd?.({
							index: i,
							event: { ...event, x: event.x - bounds.x, y: event.y - bounds.y },
						});
					}
					continue;
				}

				if (event.type === "down") {
					onClick?.({
						index: i,
						event: { ...event, x: event.x - bounds.x, y: event.y - bounds.y },
					});
					drags.current.set(i, event);
				}
			}
		},
		motion: !!onHoverStart || !!onHoverEnd,
		drag: !!onDrag,
		isActive,
	});

	return { mouseRef };
};
