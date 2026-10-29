import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function that never changes identity yet always runs the latest `callback`,
 * for whatever is set up once and calls back later, like an editor extension.
 *
 * The latest one is taken in once a render commits, so calling it during render
 * runs the one before; a render that needs the result should compute it itself.
 */
export const useLatestCallback = <Args extends unknown[], Result>(
	callback: (...args: Args) => Result,
) => {
	const ref = useRef(callback);
	useLayoutEffect(() => {
		ref.current = callback;
	});
	return useCallback((...args: Args) => ref.current(...args), []);
};
