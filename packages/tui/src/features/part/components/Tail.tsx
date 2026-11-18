import { ScrollView } from "better-ink-ui";
import type { ReactNode } from "react";

/** Rows content is held to while it is open on its own. */
const TAIL_ROWS = 20;

/**
 * Holds growing content to a fixed height and keeps its end in view, the way
 * a terminal does, until the reader scrolls away from it; reaching the bottom
 * again picks the end back up. Released once `follow` does, showing the whole
 * of it.
 */
export default function Tail({
	follow,
	children,
}: {
	follow: boolean;
	children: ReactNode;
}) {
	if (!follow) return children;
	return (
		// The transcript this sits in takes the wheel back once this reaches the
		// edge it is turned towards.
		<ScrollView
			maxHeight={TAIL_ROWS}
			flexShrink={0}
			stickToBottom
			overscan={Number.POSITIVE_INFINITY}
		>
			{children}
		</ScrollView>
	);
}
