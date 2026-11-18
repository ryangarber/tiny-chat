import { Box, Text } from "better-ink-ui";
import { type DOMElement, useBoxMetrics } from "ink";
import { useRef } from "react";

/**
 * A rule across the width of whatever contains it.
 *
 * Drawn as a box border rather than a row of dashes, because a border is laid
 * out at the width the container ends up with. Dashes have to be counted out to
 * a width Ink only knows after layout, which costs a measure and a second
 * render of every rule on screen — and a first render wide enough to cover any
 * terminal, which Ink then wraps and truncates character by character.
 *
 * Actually, not done like that, fuck you Claude Opus and your useless changes
 * that break things you don't even verify. "AGI" my ass.
 */
export default function Divider() {
	const ref = useRef<DOMElement>(null);
	const { width } = useBoxMetrics(ref);
	return (
		<Box ref={ref} width="100%">
			<Text color="border">{"─".repeat(Math.max(1, width))}</Text>
		</Box>
	);
}
