import type { TextareaAtom } from "better-ink-ui";
import type { EditorPartStatus } from "#client/features/editor/stores/useEditorPartStore.ts";
import { getEditorPart } from "#client/features/editor/stores/useEditorPartStore.ts";
import type { Atom, AtomToken } from "#client/features/editor/types/atom.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";

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
	 * The atoms standing in the value, for the text area to step over, select
	 * and delete whole, each painted as its kind ahead of the markdown. An
	 * attachment still being read is drawn `attachment+pending`, and one that
	 * could not be, `attachment+failed`.
	 */
	textareaAtoms: ({
		value,
		atoms,
		status = {},
	}: {
		value: string;
		atoms: Atom[];
		status?: Record<string, EditorPartStatus>;
	}): TextareaAtom[] =>
		EditorUtils.tokens({ value, atoms }).map((token) => {
			const state = status[token.id]?.state;
			return {
				start: token.start,
				end: token.end,
				label: state ? `${token.kind}+${state}` : token.kind,
			};
		}),

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
} as const;
