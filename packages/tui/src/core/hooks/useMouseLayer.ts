import type { DOMElement } from "ink";
import { type RefObject, useEffect } from "react";
import { MouseUtils } from "#tui/core/utils/MouseUtils.ts";

/**
 * Draws the element as an overlay: where it lies, only what is drawn inside
 * it takes the mouse, rather than whatever it covers.
 */
export const useMouseLayer = (
	ref: RefObject<DOMElement | null>,
	isActive = true,
) => {
	useEffect(() => {
		if (!isActive || !ref.current) return;
		return MouseUtils.addLayer(ref.current);
	}, [ref, isActive]);
};
