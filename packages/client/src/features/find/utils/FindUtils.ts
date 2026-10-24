import type {
	FindBlock,
	FindHit,
	FindMatch,
	FindOptions,
	FindPoint,
	FindSearchSegment,
} from "#client/features/find/types/find.ts";

const DEFAULT_LIMIT = 1000;

/** Escapes everything a `u` pattern treats as syntax. */
const escapePattern = (text: string) =>
	text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

export const FindUtils = {
	/**
	 * Every non-overlapping match of `query` in `blocks`, in reading order.
	 *
	 * Each block is searched as the text of its pieces joined together, so a
	 * match reaches across however the runtime happened to split it up — a word
	 * in a link, or code split into tokens by its highlighting.
	 */
	search: <N>(
		blocks: Iterable<FindBlock<N>>,
		query: string,
		{ caseSensitive = false, limit = DEFAULT_LIMIT }: FindOptions = {},
	): FindMatch<N>[] => {
		if (!query) return [];
		// Matched with a pattern rather than by lowercasing both sides, which
		// can change a string's length and so every offset after it.
		const pattern = new RegExp(
			escapePattern(query),
			caseSensitive ? "gu" : "giu",
		);
		const matches: FindMatch<N>[] = [];

		for (const block of blocks) {
			if (!block.length) continue;
			const text = block.map((piece) => piece.text).join("");
			const starts: number[] = [];
			let offset = 0;
			for (const piece of block) {
				starts.push(offset);
				offset += piece.text.length;
			}

			for (const found of text.matchAll(pattern)) {
				const from = found.index;
				const to = from + found[0].length;
				const pieces: FindMatch<N>["pieces"] = [];
				block.forEach((piece, i) => {
					const start = Math.max(from, starts[i]) - starts[i];
					const end = Math.min(to, starts[i] + piece.text.length) - starts[i];
					if (start < end) pieces.push({ node: piece.node, start, end });
				});
				const first = pieces[0];
				const last = pieces[pieces.length - 1];
				const start: FindPoint<N> = { node: first.node, offset: first.start };
				const end: FindPoint<N> = { node: last.node, offset: last.end };
				matches.push({ start, end, pieces });
				if (matches.length >= limit) return matches;
			}
		}

		return matches;
	},

	/**
	 * Every match of `query` across `segments`, in reading order: in what is
	 * drawn of a segment where all of it is, and in its data where it is not.
	 */
	hits: <N>(
		segments: Iterable<FindSearchSegment<N>>,
		query: string,
		{ limit = DEFAULT_LIMIT, ...options }: FindOptions = {},
	): FindHit<N>[] => {
		if (!query) return [];
		const hits: FindHit<N>[] = [];
		for (const segment of segments) {
			const left = { ...options, limit: limit - hits.length };
			if (segment.drawn) {
				const found = FindUtils.search(segment.drawn, query, left);
				for (let ordinal = 0; ordinal < found.length; ordinal++)
					hits.push({ key: segment.key, ordinal, match: found[ordinal] });
			} else if (segment.blocks) {
				const blocks = segment.blocks.map((text) => [{ node: null, text }]);
				const found = FindUtils.search(blocks, query, left);
				for (let ordinal = 0; ordinal < found.length; ordinal++)
					hits.push({ key: segment.key, ordinal });
			}
			if (hits.length >= limit) break;
		}
		return hits;
	},

	/**
	 * Where `hit` is in `hits`, searched again: the same match of the same
	 * segment, or the nearest one before it there once its segment's matches
	 * have changed — as they do when it goes from its data to being drawn.
	 */
	locate: <N>(hits: FindHit<N>[], hit: FindHit<N>) => {
		let nearest = -1;
		for (let i = 0; i < hits.length; i++) {
			if (hits[i].key !== hit.key) {
				if (nearest !== -1) break;
				continue;
			}
			if (hits[i].ordinal > hit.ordinal) break;
			nearest = i;
		}
		return nearest;
	},

	/** Whether two hits are the same match, drawn the same way. */
	isSameHit: <N>(a: FindHit<N>, b: FindHit<N>) =>
		a.key === b.key &&
		a.ordinal === b.ordinal &&
		(a.match && b.match
			? FindUtils.isEqual(a.match, b.match)
			: !a.match === !b.match),

	/** Whether two matches cover the same text of the same nodes. */
	isEqual: <N>(a: FindMatch<N>, b: FindMatch<N>) =>
		a.pieces.length === b.pieces.length &&
		a.pieces.every(
			(piece, i) =>
				piece.node === b.pieces[i].node &&
				piece.start === b.pieces[i].start &&
				piece.end === b.pieces[i].end,
		),
} as const;
