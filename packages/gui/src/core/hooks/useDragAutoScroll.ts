import type { RefCallback } from "react";
import { useCallback, useEffect, useState } from "react";

/** Distance from the viewport's top or bottom edge where scrolling starts. */
const EDGE_SIZE = 48;
/** Pixels per frame at the very edge (or past it). */
const MAX_SPEED = 16;

/**
 * Scrolls a viewport while a native drag hovers near (or past) its top or
 * bottom edge. Native drag-and-drop doesn't scroll custom scroll areas on its
 * own, so without this nothing offscreen can be dropped onto.
 */
export function useDragAutoScroll(active: boolean) {
	const [viewport, setViewport] = useState<HTMLElement | null>(null);
	const viewportRef = useCallback<RefCallback<HTMLElement>>(
		(node) => setViewport(node),
		[],
	);

	useEffect(() => {
		if (!active || !viewport) return;

		let pointerY: number | null = null;
		let frame = 0;

		const step = () => {
			frame = requestAnimationFrame(step);
			if (pointerY === null) return;

			const { top, bottom } = viewport.getBoundingClientRect();
			// Ramp from 0 at the inner edge of the zone to full speed at the edge.
			const speed = (depth: number) =>
				Math.ceil(MAX_SPEED * Math.min(1, depth / EDGE_SIZE));
			if (pointerY < top + EDGE_SIZE)
				viewport.scrollTop -= speed(top + EDGE_SIZE - pointerY);
			else if (pointerY > bottom - EDGE_SIZE)
				viewport.scrollTop += speed(pointerY - (bottom - EDGE_SIZE));
		};

		const onDragOver = (event: DragEvent) => {
			const { left, right } = viewport.getBoundingClientRect();
			pointerY =
				event.clientX >= left && event.clientX <= right ? event.clientY : null;
		};
		const stop = () => {
			pointerY = null;
		};

		document.addEventListener("dragover", onDragOver);
		document.addEventListener("drop", stop);
		document.addEventListener("dragend", stop);
		frame = requestAnimationFrame(step);

		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("dragover", onDragOver);
			document.removeEventListener("drop", stop);
			document.removeEventListener("dragend", stop);
		};
	}, [active, viewport]);

	return { viewportRef };
}
