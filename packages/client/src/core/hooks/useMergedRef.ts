/** @author https://github.com/mantinedev/mantine/blob/master/packages/@mantine/hooks/src/use-merged-ref/use-merged-ref.ts */

import { type Ref, type RefCallback, useMemo } from "react";
import { useStableValue } from "#client/core/hooks/useStableValue.ts";

type PossibleRef<T> = Ref<T> | undefined;

type RefCleanup<T> = ReturnType<RefCallback<T>>;

function assignRef<T>(ref: PossibleRef<T>, value: T): RefCleanup<T> {
	if (typeof ref === "function") {
		return ref(value);
	} else if (typeof ref === "object" && ref !== null && "current" in ref) {
		ref.current = value;
	}
}

function mergeRefs<T>(...refs: PossibleRef<T>[]): RefCallback<T> {
	const cleanupMap = new Map<PossibleRef<T>, Exclude<RefCleanup<T>, void>>();

	return (node: T | null) => {
		refs.forEach((ref) => {
			const cleanup = assignRef(ref, node);
			if (cleanup) {
				cleanupMap.set(ref, cleanup);
			}
		});

		if (cleanupMap.size > 0) {
			return () => {
				refs.forEach((ref) => {
					const cleanup = cleanupMap.get(ref);
					if (cleanup && typeof cleanup === "function") {
						cleanup();
					} else {
						assignRef(ref, null);
					}
				});
				cleanupMap.clear();
			};
		}
	};
}

const isSameRefs = <T>(a: PossibleRef<T>[], b: PossibleRef<T>[]) =>
	a.length === b.length && a.every((ref, index) => ref === b[index]);

export function useMergedRef<T>(...refs: PossibleRef<T>[]) {
	// The rest array is new each render; the merged ref changes only with a ref.
	const stableRefs = useStableValue(refs, isSameRefs);
	return useMemo(() => mergeRefs(...stableRefs), [stableRefs]);
}
