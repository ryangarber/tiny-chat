import { type ReactNode, useRef } from "react";
import {
	FindSegmentContext,
	useFindSegment,
} from "#client/features/find/hooks/useFindScope.ts";

/**
 * One of the segments the scope it is drawn in searches, under the key that
 * scope's data gives it. Takes no room of its own.
 */
export default function FindSegment({
	id,
	children,
}: {
	id: string;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const segments = useFindSegment(id, ref);
	return (
		<div ref={ref} style={{ display: "contents" }}>
			<FindSegmentContext value={segments}>{children}</FindSegmentContext>
		</div>
	);
}
