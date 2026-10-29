import { useState } from "react";

/**
 * `value`, or the one held from an earlier render for as long as `isEqual`
 * finds them the same, so whatever is memoized on it keeps its identity.
 *
 * Held in state rather than a ref: a changed value is adopted during render,
 * which React restarts at once with it, so no render reads one render behind.
 */
export const useStableValue = <T>(
	value: T,
	isEqual: (a: T, b: T) => boolean,
): T => {
	const [held, setHeld] = useState(value);
	const same = held === value || isEqual(held, value);
	if (!same) setHeld(value);
	return same ? held : value;
};
