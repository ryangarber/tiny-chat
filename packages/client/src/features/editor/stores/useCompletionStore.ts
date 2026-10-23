import { create } from "zustand";

interface CompletionStore {
	isCompletionsOpen: boolean;
	isCompletionsEmpty: boolean;
}

/** Written by the open completion list via `setState`, read by the editor. */
export const useCompletionStore = create<CompletionStore>(() => ({
	isCompletionsOpen: false,
	isCompletionsEmpty: true,
}));
