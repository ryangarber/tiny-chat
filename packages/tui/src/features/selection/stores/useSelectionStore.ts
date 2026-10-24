import { create } from "zustand";

/** Whatever holds the selection, and how to let it go. */
interface SelectionHolder {
	id: string;
	clear: () => void;
}

interface SelectionStore {
	/**
	 * The one selection keys go to, as a terminal has only the one: Ctrl+C
	 * copies out of it rather than quitting, and Shift and the arrows stretch it
	 * wherever the focus is.
	 */
	holder: SelectionHolder | null;
	/** Takes the selection over, clearing whichever other one held it. */
	hold: (holder: SelectionHolder) => void;
	/** Gives the selection up, if `id` still holds it, leaving it drawn. */
	release: (id: string) => void;
	/** Clears the selection held, unless `id` holds it. */
	clear: (id?: string) => void;
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
	holder: null,
	hold: (holder) => {
		const previous = get().holder;
		if (previous?.id === holder.id) {
			set({ holder });
			return;
		}
		set({ holder });
		previous?.clear();
	},
	release: (id) => {
		if (get().holder?.id === id) set({ holder: null });
	},
	clear: (id) => {
		const { holder } = get();
		if (!holder || holder.id === id) return;
		set({ holder: null });
		holder.clear();
	},
}));
