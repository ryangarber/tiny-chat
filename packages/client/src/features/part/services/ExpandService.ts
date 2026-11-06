import { useExpandStore } from "#client/features/part/stores/useExpandStore.ts";

/** How long a call gone to is waited on to be drawn, before giving up on it. */
const FOCUS_TIMEOUT = 2000;

export const ExpandService = {
	/**
	 * Opens the way to a tool call — the run of calls it is folded into — and
	 * brings it into view, once it is drawn. Given up on if it is not drawn
	 * soon, so a call that never is does not take the next one gone to.
	 */
	focusToolCall: (id: string) => {
		const { focus } = useExpandStore.getState();
		focus(id);
		setTimeout(() => {
			if (useExpandStore.getState().focused === id) focus(null);
		}, FOCUS_TIMEOUT);
	},
} as const;
