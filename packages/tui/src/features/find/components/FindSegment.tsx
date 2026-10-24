import type { DOMElement } from "ink";
import { type ReactNode, useRef } from "react";
import {
	FindSegmentContext,
	useFindSegment,
} from "#client/features/find/hooks/useFindScope.ts";
import Box from "#tui/core/components/Box.tsx";

/**
 * One of the segments the scope it is drawn in searches, under the key that
 * scope's data gives it.
 */
export default function FindSegment({
	id,
	children,
}: {
	id: string;
	children: ReactNode;
}) {
	const ref = useRef<DOMElement>(null);
	const segments = useFindSegment(id, ref);
	return (
		<Box ref={ref} flexDirection="column" flexShrink={0}>
			<FindSegmentContext value={segments}>{children}</FindSegmentContext>
		</Box>
	);
}
