import { useRef, useState } from "react";
import { useFind } from "#client/features/find/hooks/useFind.ts";
import { FindScopeService } from "#client/features/find/services/FindScopeService.ts";
import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import type {
	FindBlock,
	FindMatch,
	FindOptions,
} from "#client/features/find/types/find.ts";

/**
 * Find in page over one registered scope at a time, whichever runtime draws
 * it: the runtime reads the text out of its own nodes with `blocksOf` and
 * scrolls a match into view with `reveal`; what is not drawn is searched from
 * the scope's data and drawn when it is stepped onto.
 *
 * `target` sets the scope searched, taking effect at once, so it can be called
 * with `open` or `restart` in the same handler.
 */
export function useFindInScope<N>({
	blocksOf,
	reveal,
	...options
}: FindOptions & {
	blocksOf: (node: N) => Iterable<FindBlock<N>>;
	reveal: (match: FindMatch<N>) => void;
}) {
	const [scope, setScope] = useState<string | null>(null);
	// Read as find searches, which can be before the render that changes it.
	const scopeRef = useRef<string | null>(null);
	const target = (id: string | null) => {
		scopeRef.current = id;
		setScope(id);
	};

	const find = useFind<N>(
		{
			segments: () =>
				scopeRef.current
					? FindScopeService.segments(scopeRef.current, blocksOf)
					: [],
			reveal: (match, key) => {
				// What find opened for an earlier match closes again once it moves
				// on to one elsewhere; what the user opened is theirs.
				const revealed = useFindStore.getState().revealed;
				if (revealed && revealed.key !== key)
					useFindStore.getState().unreveal();
				reveal(match);
			},
			show: (key) =>
				scopeRef.current
					? FindScopeService.show(scopeRef.current, key)
					: Promise.resolve(),
		},
		options,
	);

	return { ...find, scope, target };
}
