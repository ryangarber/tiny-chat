import { useState } from "react";

/** Escape hides a query until the cursor leaves the text that opened it. */
export const useCompletionDismissal = <T extends { from: number }>(
	query: T | null,
) => {
	const [dismissedFrom, setDismissedFrom] = useState<number | null>(null);

	// Query objects and their text change while typing or moving inside a
	// token. Only leaving its trigger rearms completions, including a move
	// directly to a different token.
	if (dismissedFrom !== null && dismissedFrom !== query?.from) {
		setDismissedFrom(null);
	}

	return {
		query: query && query.from !== dismissedFrom ? query : null,
		dismiss: () => {
			if (query) setDismissedFrom(query.from);
		},
	};
};
