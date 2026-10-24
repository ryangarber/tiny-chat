/**
 * Text drawn as one piece by the runtime: a DOM text node in the app, a block
 * of text in the CLI. `node` is whatever the runtime needs to find it again.
 */
export interface FindPiece<N> {
	node: N;
	text: string;
}

/**
 * A run of text that reads as one — a paragraph, a block of code — and that a
 * match may span, across as many of its pieces as it takes. Matches never
 * cross from one block into the next, as a browser's never cross paragraphs.
 */
export type FindBlock<N> = FindPiece<N>[];

/** Where a match starts or ends: an offset into one piece's text. */
export interface FindPoint<N> {
	node: N;
	offset: number;
}

/** A match of the query, handed back in the runtime's own nodes. */
export interface FindMatch<N> {
	start: FindPoint<N>;
	end: FindPoint<N>;
	/**
	 * Every piece the match covers, with the part of its text that is matched,
	 * for a runtime that highlights piece by piece.
	 */
	pieces: { node: N; start: number; end: number }[];
}

export interface FindOptions {
	caseSensitive?: boolean;
	/** Beyond this many a search stops counting, as browsers' own find bars do. */
	limit?: number;
}

/**
 * A piece of what a scope holds — a message's part, a block of code — as its
 * data has it, so it can be found while it is not drawn: scrolled out of a
 * virtualized list, or folded shut. `blocks` only has to read close to what is
 * drawn, which takes over as soon as it is.
 */
export interface FindSegment {
	key: string;
	blocks?: string[];
}

/** A segment as it is searched: what is drawn of it, or else its data. */
export interface FindSearchSegment<N> extends FindSegment {
	/** Present only while all of the segment is drawn. */
	drawn?: Iterable<FindBlock<N>>;
}

/**
 * A match placed by its segment and its count within it, which holds while the
 * segment goes from being known by its data to being drawn.
 */
export interface FindHit<N> {
	key: string;
	ordinal: number;
	/** Where it is drawn, absent while its segment is not. */
	match?: FindMatch<N>;
}

/**
 * What a runtime gives find in page: the text it holds, and a way to show a
 * match. Highlighting goes back through the hits `useFind` returns.
 */
export interface FindAdapter<N> {
	/** The segments to search, in reading order, read afresh on every search. */
	segments: () => Iterable<FindSearchSegment<N>>;
	/** Brings a drawn match into view as it becomes the current one. */
	reveal?: (match: FindMatch<N>, key: string) => void;
	/**
	 * Has a segment drawn in full, settling once it is, or once there is no
	 * more point waiting for it.
	 */
	show?: (key: string) => Promise<void>;
}
