import { TextareaUtils, type TextSelection } from "better-ink-ui";
import { create } from "zustand";
import {
	getEditorPart,
	useEditorPartStore,
} from "#client/features/editor/stores/useEditorPartStore.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";
import { PasteUtils } from "#client/features/editor/utils/PasteUtils.ts";
import {
	type EditorUnfolded,
	EditorUtils,
} from "#tui/features/editor/utils/EditorUtils.ts";

interface EditorStore {
	selection: TextSelection | null;
	setSelection: (selection: TextSelection | null) => void;

	content: string;
	setContent: (content: string) => void;

	/**
	 * Where the next write lands. Held here rather than in the editor alone so
	 * that something offering an attachment from another page — an upload, a
	 * repository — can write it in where the cursor was left.
	 */
	cursor: [row: number, column: number];
	setCursor: (cursor: [row: number, column: number]) => void;

	/** Writes text in at the cursor, over `range` when one is given. */
	insert: (text: string, range?: [start: number, end: number]) => void;

	/** The paste written out in full in place of its atom, while there is one. */
	unfolded: EditorUnfolded | null;

	/**
	 * Writes the paste at an offset out in full in place of its atom, with the
	 * cursor at its start. False when there is no paste there.
	 */
	unfold: (offset: number) => boolean;

	/**
	 * Folds the unfolded paste back into an atom once the cursor has left it,
	 * keeping whatever was edited inside of it.
	 *
	 * @param isForced Folds it wherever the cursor is, for a message on its way out.
	 */
	refold: (isForced?: boolean) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
	selection: null,
	setSelection: (selection) => set({ selection }),

	content: "",
	setContent: (content) => set({ content }),

	cursor: [0, 0],
	setCursor: (cursor) => set({ cursor }),

	insert: (text, range) => {
		const { content, cursor } = get();

		const offset = TextareaUtils.offset(content, cursor);
		const [start, end] = range ?? [offset, offset];

		const next = content.slice(0, start) + text + content.slice(end);

		set({
			content: next,
			cursor: TextareaUtils.cursor(next, start + text.length),
		});
	},

	unfolded: null,

	unfold: (offset) => {
		let at = offset;

		// One open at a time: a click outside the one already open folds it up
		// first, which moves anything after it.
		const { unfolded } = get();
		const span = unfolded && EditorUtils.unfolded(get().content, unfolded);
		if (span) {
			if (at >= span[0] && at <= span[1]) return false;

			const length = get().content.length;
			get().refold(true);
			if (at > span[1]) at += get().content.length - length;
		}

		const { content } = get();
		const opened = EditorUtils.unfold({
			value: content,
			atoms: AtomUtils.atoms(),
			offset: at,
		});
		if (!opened) return false;

		set({
			content: opened.value,
			cursor: TextareaUtils.cursor(opened.value, opened.start),
			selection: null,
			unfolded: opened.unfolded,
		});
		return true;
	},

	refold: (isForced = false) => {
		const { content, cursor, unfolded } = get();
		if (!unfolded) return;

		const span = EditorUtils.unfolded(content, unfolded);
		if (!span) {
			// Edited from outside, so it stands as the text it now is.
			set({ unfolded: null });
			return;
		}

		const [start, end] = span;
		const offset = TextareaUtils.offset(content, cursor);
		if (!isForced && offset >= start && offset <= end) return;

		const { before, after } = unfolded;
		const text = content.slice(start, end);
		const part = getEditorPart("paste", unfolded.id);

		// Emptied out, gone from the registry, or cut down to where a paste of it
		// would not have been folded away, it is left as what is there.
		let folded = text;
		if (part && text.trim() && PasteUtils.isLong(text)) {
			const edited = { ...part, text, lines: PasteUtils.lines(text).length };
			useEditorPartStore.getState().addPart(edited);
			folded = AtomUtils.fromPart({ content: before + after, part: edited });
		}

		const next = before + folded + after;
		set({
			content: next,
			cursor: TextareaUtils.cursor(
				next,
				offset < start ? offset : offset - (end - start) + folded.length,
			),
			unfolded: null,
		});
	},
}));

/** Write a shared editor node as the atom standing for it in the CLI buffer. */
export const insertNode = (node: EditorNode) => {
	const { content, insert } = useEditorStore.getState();
	const text = AtomUtils.fromNode({ content, node });

	insert(`${text} `);
};
