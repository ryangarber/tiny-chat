import { create } from "zustand";

interface ToolFeedbackStore {
	/**
	 * Calls a live generation is waiting on the user's answer to, with the
	 * chat each is in: none for a subagent's.
	 */
	awaiting: Map<string, string | null>;
	/** Calls the user has answered that have not settled with a result yet. */
	answered: Set<string>;
	/** Waits on a call in `chatId`, or stops waiting with `false`. */
	setAwaiting: (id: string, chatId: string | null | false) => void;
	setAnswered: (id: string, value: boolean) => void;
}

export const useToolFeedbackStore = create<ToolFeedbackStore>((set) => ({
	awaiting: new Map(),
	answered: new Set(),
	setAwaiting: (id, chatId) =>
		set((state) => {
			if (
				chatId === false
					? !state.awaiting.has(id)
					: state.awaiting.get(id) === chatId
			)
				return state;
			const awaiting = new Map(state.awaiting);
			if (chatId === false) awaiting.delete(id);
			else awaiting.set(id, chatId);
			return { awaiting };
		}),
	setAnswered: (id, value) =>
		set((state) => {
			if (state.answered.has(id) === value) return state;
			const answered = new Set(state.answered);
			if (value) answered.add(id);
			else answered.delete(id);
			return { answered };
		}),
}));
