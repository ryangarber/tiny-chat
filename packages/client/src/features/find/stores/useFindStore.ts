import { create } from "zustand";

interface FindStore {
	/**
	 * The scope last pointed at, clicked or focused: where the next search
	 * looks. Kept apart from the focus, so that clicking into a block of code
	 * scopes find to it without taking the focus from the composer.
	 */
	active: string | null;
	activate: (id: string | null) => void;
	/**
	 * The segment find is showing a match in, for whatever hides some of it to
	 * open: a virtualized list, a folded tool call, a tail of output. Held
	 * after the bar closes, so what it was left on stays open.
	 */
	revealed: { scope: string; key: string; nonce: number } | null;
	reveal: (scope: string, key: string) => void;
	unreveal: () => void;
}

export const useFindStore = create<FindStore>((set) => ({
	active: null,
	activate: (id) =>
		set((state) => (state.active === id ? state : { active: id })),
	revealed: null,
	reveal: (scope, key) =>
		set((state) => ({
			revealed: { scope, key, nonce: (state.revealed?.nonce ?? 0) + 1 },
		})),
	unreveal: () => set((state) => (state.revealed ? { revealed: null } : state)),
}));
