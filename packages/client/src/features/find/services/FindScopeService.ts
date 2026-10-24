import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import type {
	FindBlock,
	FindSearchSegment,
	FindSegment,
} from "#client/features/find/types/find.ts";

/** How long a segment find has asked to see is waited on to be drawn. */
const SHOW_TIMEOUT = 1000;
const SHOW_POLL = 16;

/** A part of the screen that can be searched on its own. */
export interface FindScope {
	parent?: string;
	/** What the bar calls it: "Chat", a file's name. */
	label: string;
	/** Holds the find bar, for itself and the scopes inside it. */
	region: boolean;
	/** The runtime's node it draws into. */
	node: () => unknown;
	/**
	 * Whether what it holds is given as segments, from data, by something
	 * drawn inside it. A scope that is not is one segment of whatever it
	 * draws, keyed by its own id.
	 */
	segmented: boolean;
	/** Its text from data, for a scope that is not segmented but hides some. */
	text?: () => string[];
}

const scopes = new Map<string, FindScope>();
/** Segments given to each segmented scope, held apart from it: what gives them is drawn inside it, so registers first. */
const provided = new Map<string, () => Iterable<FindSegment>>();
/** The segments drawn of each scope, by key. */
const drawn = new Map<string, Map<string, () => unknown>>();
/** What hides some of a segment while it is drawn, by scope and key. */
const hidden = new Map<string, Set<symbol>>();
const listeners = new Set<() => void>();
/** Counts every change to the scopes registered, for `useSyncExternalStore`. */
let version = 0;

const hiddenKey = (scope: string, key: string) => `${scope}\u0000${key}`;

const isComplete = (scope: string, key: string) =>
	!!drawn.get(scope)?.get(key)?.() && !hidden.get(hiddenKey(scope, key))?.size;

const changed = () => {
	version++;
	for (const listener of listeners) listener();
};

/**
 * Where find keeps the scopes on screen and what is drawn of each. Both
 * runtimes register through it, each with its own nodes, and search a scope
 * with its own way of reading the text out of them.
 */
export const FindScopeService = {
	register: (id: string, scope: FindScope) => {
		scopes.set(id, scope);
		changed();
		return () => {
			if (scopes.get(id) === scope) scopes.delete(id);
			changed();
		};
	},

	/** Gives a segmented scope its segments, from inside where it draws them. */
	provide: (id: string, segments: () => Iterable<FindSegment>) => {
		provided.set(id, segments);
		return () => {
			if (provided.get(id) === segments) provided.delete(id);
		};
	},

	get: (id: string | null | undefined) => (id ? scopes.get(id) : undefined),

	/** Every scope registered, by id. */
	entries: () => scopes.entries(),

	version: () => version,

	/** Called whenever a scope is added or removed. */
	subscribe: (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},

	/**
	 * `id` while it is registered, or else `fallback`: a scope can go away
	 * under the find bar searching it.
	 */
	resolve: (id: string | null | undefined, fallback?: string | null) => {
		if (id && scopes.has(id)) return id;
		return fallback && scopes.has(fallback) ? fallback : undefined;
	},

	/** The scope that holds the bar for `id`: itself, or its nearest region. */
	region: (id: string) => {
		for (
			let current: string | undefined = id;
			current;
			current = scopes.get(current)?.parent
		)
			if (scopes.get(current)?.region) return current;
		return id;
	},

	/** Marks a segment of a scope drawn while `node` returns its node. */
	draw: (scope: string, key: string, node: () => unknown) => {
		let segments = drawn.get(scope);
		if (!segments) {
			segments = new Map();
			drawn.set(scope, segments);
		}
		segments.set(key, node);
		return () => {
			if (segments.get(key) === node) segments.delete(key);
			if (!segments.size && drawn.get(scope) === segments) drawn.delete(scope);
		};
	},

	/** Marks some of a segment hidden, such as a part of it folded shut. */
	hide: (scope: string, key: string) => {
		const id = hiddenKey(scope, key);
		const token = Symbol();
		let tokens = hidden.get(id);
		if (!tokens) {
			tokens = new Set();
			hidden.set(id, tokens);
		}
		tokens.add(token);
		return () => {
			tokens.delete(token);
			if (!tokens.size && hidden.get(id) === tokens) hidden.delete(id);
		};
	},

	/**
	 * What to search in a scope: each of its segments with whatever of it is
	 * drawn read out by `blocksOf`, or with its data where it is not all drawn.
	 */
	segments: function* <N>(
		id: string,
		blocksOf: (node: N) => Iterable<FindBlock<N>>,
	): Generator<FindSearchSegment<N>> {
		const scope = scopes.get(id);
		if (!scope) return;
		const segments = scope.segmented
			? (provided.get(id)?.() ?? [])
			: [{ key: id, blocks: scope.text?.() }];
		for (const segment of segments) {
			const node = isComplete(id, segment.key)
				? (drawn.get(id)?.get(segment.key)?.() as N | null | undefined)
				: undefined;
			yield node ? { ...segment, drawn: blocksOf(node) } : segment;
		}
	},

	/**
	 * Asks for a segment to be drawn in full, settling once it is or once it
	 * has been waited on long enough that it will not be.
	 */
	show: (scope: string, key: string) => {
		useFindStore.getState().reveal(scope, key);
		const start = Date.now();
		return new Promise<void>((resolve) => {
			const poll = () => {
				if (isComplete(scope, key) || Date.now() - start > SHOW_TIMEOUT)
					resolve();
				else setTimeout(poll, SHOW_POLL);
			};
			poll();
		});
	},
} as const;
