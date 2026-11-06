import type { EditorPartStatus } from "#client/features/editor/stores/useEditorPartStore.ts";
import { getEditorPart } from "#client/features/editor/stores/useEditorPartStore.ts";
import type { Atom, AtomToken } from "#client/features/editor/types/atom.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";
import type {
	TextareaLabels,
	TextareaSelection,
} from "#tui/features/textarea/types/textarea.ts";
import { TextareaUtils } from "#tui/features/textarea/utils/TextareaUtils.ts";

/**
 * The atoms standing in the editor's value — the commands, the attachments and
 * the pastes — which the text area paints, steps over and takes out whole.
 */

/** A command, an attachment or a paste, which is only ever handled whole. */
export type EditorToken = AtomToken;

/**
 * A paste written out in full in place of its atom, held by the text standing
 * either side of it — which an edit inside it leaves as it was.
 */
export type EditorUnfolded = { id: string; before: string; after: string };

export const EditorUtils = {
	/**
	 * Rules that paint the atoms — the commands, the attachments and the pastes
	 * — for the text area's `labels`. They are read in order and the first rule
	 * to claim a character keeps it, so these come before the markdown's.
	 */
	/**
	 * Paints each atom as its kind; an attachment still being read is drawn
	 * `attachment+pending`, and one that could not be, `attachment+failed`.
	 */
	tokenLabels: ({
		atoms,
		status = {},
	}: {
		atoms: Atom[];
		status?: Record<string, EditorPartStatus>;
	}): TextareaLabels => {
		const pattern = AtomUtils.pattern({ atoms });
		if (!pattern) return [];

		return [
			{
				pattern,
				label: (match) => {
					const atom = AtomUtils.find({ atoms, text: match[0] });
					if (!atom) return undefined;
					const state = status[atom.id]?.state;
					return state ? `${atom.kind}+${state}` : atom.kind;
				},
			},
		];
	},

	/** Every atom standing in the value, in order. */
	tokens: ({ value, atoms }: { value: string; atoms: Atom[] }): EditorToken[] =>
		AtomUtils.tokens({ content: value, atoms }),

	/** The token the offset sits inside of, ends excluded. */
	token: ({
		value,
		atoms,
		offset,
	}: {
		value: string;
		atoms: Atom[];
		offset: number;
	}) =>
		EditorUtils.tokens({ value, atoms }).find(
			({ start, end }) => offset > start && offset < end,
		) ?? null,

	/**
	 * The value with the paste a click at the offset landed on written out in
	 * full in place of its atom. Null when the click landed on no paste.
	 */
	unfold: ({
		value,
		atoms,
		offset,
	}: {
		value: string;
		atoms: Atom[];
		offset: number;
	}): { value: string; unfolded: EditorUnfolded; start: number } | null => {
		const token = EditorUtils.tokens({ value, atoms }).find(
			({ kind, start, end }) =>
				kind === "paste" && offset >= start && offset < end,
		);
		if (!token) return null;

		const part = getEditorPart("paste", token.id);
		if (!part) return null;

		const before = value.slice(0, token.start);
		const after = value.slice(token.end);

		return {
			value: before + part.text + after,
			unfolded: { id: token.id, before, after },
			start: token.start,
		};
	},

	/**
	 * Where an unfolded paste stands in the value. Null once an edit outside of
	 * it has moved the text either side, and there is no telling any more.
	 */
	unfolded: (
		value: string,
		{ before, after }: EditorUnfolded,
	): [start: number, end: number] | null => {
		if (value.length < before.length + after.length) return null;
		if (!value.startsWith(before) || !value.endsWith(after)) return null;
		return [before.length, value.length - after.length];
	},

	/** Stretches a selection out to the ends of any token it reaches into. */
	expand: ({
		value,
		atoms,
		selection,
	}: {
		value: string;
		atoms: Atom[];
		selection: TextareaSelection;
	}): TextareaSelection => {
		const [start, end] = TextareaUtils.range(selection);
		const reached = EditorUtils.tokens({ value, atoms }).filter(
			(token) => token.start < end && token.end > start,
		);
		if (reached.length === 0) return selection;

		const from = Math.min(start, reached[0].start);
		const to = Math.max(end, reached[reached.length - 1].end);

		// Kept pointing the way it was dragged, so it can go on growing either way.
		return selection[0] <= selection[1] ? [from, to] : [to, from];
	},

	/**
	 * The offset a cursor landing on this one should take instead, so that it
	 * never comes to rest inside a token. Moves along with the direction it was
	 * travelling, or out the near end when it did not travel at all.
	 */
	snap: ({
		value,
		atoms,
		offset,
		from = offset,
	}: {
		value: string;
		atoms: Atom[];
		offset: number;
		from?: number;
	}) => {
		const token = EditorUtils.token({ value, atoms, offset });
		if (!token) return offset;

		if (from <= token.start) return token.end;
		if (from >= token.end) return token.start;

		return offset - token.start < token.end - offset ? token.start : token.end;
	},

	/**
	 * The range a delete at the offset should take out, when a token is up
	 * against it or around it. Null when there is none and the text area's own
	 * delete is right.
	 */
	deletion: ({
		value,
		atoms,
		offset,
		direction,
	}: {
		value: string;
		atoms: Atom[];
		offset: number;
		direction: 1 | -1;
	}): [start: number, end: number] | null => {
		for (const { start, end } of EditorUtils.tokens({ value, atoms })) {
			if (offset > start && offset < end) return [start, end];
			if (direction === -1 && offset === end) return [start, end];
			if (direction === 1 && offset === start) return [start, end];
		}

		return null;
	},

	/**
	 * The range an Alt delete at the offset should take out.
	 *
	 * An atom against the cursor goes whole, the way a plain delete takes it,
	 * and a word reaching into one is cut back to its near edge — so one press
	 * never takes an atom and the text around it together.
	 */
	wordDeletion: ({
		value,
		atoms,
		offset,
		direction,
	}: {
		value: string;
		atoms: Atom[];
		offset: number;
		direction: 1 | -1;
	}): [start: number, end: number] => {
		const whole = EditorUtils.deletion({ value, atoms, offset, direction });
		if (whole) return whole;

		const target =
			direction === -1
				? TextareaUtils.wordStart(value, offset)
				: TextareaUtils.wordEnd(value, offset);

		const [start, end] = direction === -1 ? [target, offset] : [offset, target];

		const reached = EditorUtils.tokens({ value, atoms }).filter(
			(token) => token.start < end && token.end > start,
		);
		if (reached.length === 0) return [start, end];

		// No token is against the cursor or around it, so every one the word
		// reached lies beyond the near edge it is cut back to.
		return direction === -1
			? [Math.max(...reached.map((token) => token.end)), offset]
			: [offset, Math.min(...reached.map((token) => token.start))];
	},
} as const;
