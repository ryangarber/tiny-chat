import { type DOMElement, useWindowSize } from "ink";
import { FindScopeService } from "#client/features/find/services/FindScopeService.ts";
import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import { useMouse } from "#tui/core/hooks/useMouse.ts";
import { type MouseBounds, MouseUtils } from "#tui/core/utils/MouseUtils.ts";

const isElement = (node: unknown): node is DOMElement =>
	!!node && typeof node === "object" && "yogaNode" in node;

/** What can be seen of a node: its bounds, cut to every view clipping it. */
const visibleBounds = (node: DOMElement, rows: number): MouseBounds | null => {
	let { x, y, width, height } = MouseUtils.bounds(node, rows);
	for (let parent = node.parentNode; parent; parent = parent.parentNode) {
		if (parent.style.overflow !== "hidden") continue;
		const clip = MouseUtils.bounds(parent, rows);
		const right = Math.min(x + width, clip.x + clip.width);
		const bottom = Math.min(y + height, clip.y + clip.height);
		x = Math.max(x, clip.x);
		y = Math.max(y, clip.y);
		width = right - x;
		height = bottom - y;
		if (width <= 0 || height <= 0) return null;
	}
	return { x, y, width, height };
};

/**
 * Makes the innermost find scope a click lands in the one Ctrl+F searches,
 * without taking the keys from whatever has them — a block of code clicked
 * while the composer is being typed into.
 */
export const useFindClicks = (isActive: boolean) => {
	const { rows } = useWindowSize();
	useMouse({
		isActive,
		handler: (event) => {
			if (event.type !== "down") return;
			let innermost: { id: string; area: number } | null = null;
			for (const [id, scope] of FindScopeService.entries()) {
				const node = scope.node();
				if (!isElement(node)) continue;
				const bounds = visibleBounds(node, rows);
				if (
					!bounds ||
					!MouseUtils.contains(bounds, event) ||
					MouseUtils.isCovered(node, event, rows)
				)
					continue;
				const area = bounds.width * bounds.height;
				if (!innermost || area < innermost.area) innermost = { id, area };
			}
			if (innermost) useFindStore.getState().activate(innermost.id);
		},
	});
};
