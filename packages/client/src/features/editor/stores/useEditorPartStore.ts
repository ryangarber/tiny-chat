import { create } from "zustand";
import type { zEditorPart } from "#core/features/data/utils/EditorPartUtils.ts";

export type EditorPart = zEditorPart;

/**
 * Where an attachment still being read stands: `pending` until it is built,
 * `failed` with why once it could not be. A built one has no entry.
 */
export type EditorPartStatus =
	| { state: "pending" }
	| { state: "failed"; error: string };

interface EditorPartStore {
	/**
	 * Every part the editor is holding a pointer to, by id.
	 *
	 * The editor document only ever carries the id, so this is where the thing
	 * itself lives between being written and being sent. It is replaced whole
	 * whenever a message is loaded for editing: the parts standing in the
	 * document that one takes over from are gone with it.
	 */
	parts: Record<string, EditorPart>;
	setParts: (parts: EditorPart[]) => void;
	addPart: (part: EditorPart) => void;

	/**
	 * Attachments being read in the background, by the id their chip already
	 * stands under. Kept apart from `parts` and never replaced with them: a
	 * read carries on whether or not its chip is in the document, so undoing
	 * its removal or pasting it back picks up where it got to.
	 */
	status: Record<string, EditorPartStatus>;
	setStatus: (id: string, status: EditorPartStatus | null) => void;
}

export const useEditorPartStore = create<EditorPartStore>((set) => ({
	parts: {},
	setParts: (parts) =>
		set({ parts: Object.fromEntries(parts.map((part) => [part.id, part])) }),
	addPart: (part) =>
		set((state) => ({ parts: { ...state.parts, [part.id]: part } })),

	status: {},
	setStatus: (id, status) =>
		set((state) => {
			if (status) return { status: { ...state.status, [id]: status } };
			if (!(id in state.status)) return {};
			const { [id]: _, ...rest } = state.status;
			return { status: rest };
		}),
}));

/** The part a pointer of this type resolves to, or null when it has gone. */
export const getEditorPart = <T extends EditorPart["type"]>(
	type: T,
	id: string,
): Extract<EditorPart, { type: T }> | null => {
	const part = useEditorPartStore.getState().parts[id];
	if (part?.type !== type) return null;
	return part as Extract<EditorPart, { type: T }>;
};
