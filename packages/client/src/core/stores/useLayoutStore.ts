import { create } from "zustand";

/** The chat list, and the sources of the open chat. */
export type Panel = "chats" | "files";

interface LayoutStore {
	/** Kept across launches by `usePersistedPanels`. */
	panels: Record<Panel, boolean>;
	setPanel: (panel: Panel, open: boolean) => void;

	/** The memory or action its page or modal opens on, until it has. */
	record: string | null;
	setRecord: (record: string | null) => void;
}

/**
 * What the app and the CLI lay out alike. How each opens a panel or a page
 * past this — the focus it moves, the modal it shows — is its own.
 */
export const useLayoutStore = create<LayoutStore>((set) => ({
	panels: { chats: false, files: false },
	setPanel: (panel, open) =>
		set(({ panels }) =>
			panels[panel] === open ? {} : { panels: { ...panels, [panel]: open } },
		),

	record: null,
	setRecord: (record) => set({ record }),
}));
