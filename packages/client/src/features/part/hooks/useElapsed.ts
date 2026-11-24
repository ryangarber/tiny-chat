import { useEffect, useState } from "react";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zPartTime } from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";

/** Below this, a task is quick enough not to say how long it took. */
const MIN_ELAPSED_MS = 1000;

/**
 * How long a thought or tool call — or a run of them — took, written short,
 * counting on each second while any of it is still going. Unset for one that
 * took under a second, or that has no time to tell.
 */
export const useElapsed = (
	spans: { time?: zPartTime; active?: boolean }[],
): string | undefined => {
	const ticking = spans.some((span) => span.active && span.time);
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!ticking) return;
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [ticking]);

	const elapsed = DataUtils.getElapsed(spans, now);
	return elapsed !== undefined && elapsed >= MIN_ELAPSED_MS
		? CommonUtils.formatElapsed(elapsed)
		: undefined;
};
