import { useInput } from "ink";
import { useCallback } from "react";
import {
	type Page,
	useAppStore,
	useCurrentPage,
} from "#tui/core/stores/useAppStore.ts";

export const usePage = ({
	back,
	onBack,
	active = true,
}: {
	active?: boolean;
	back?: string[];
	onBack?: () => Page | boolean | undefined;
} = {}) => {
	const page = useCurrentPage();
	const setFocus = useAppStore((state) => state.setFocus);
	/** The chat is opened at its editor. */
	const setPage = useCallback(
		(page: Page) => setFocus(page === "chat" ? "editor" : page),
		[setFocus],
	);

	useInput(
		(input, key) => {
			if (
				key.backspace ||
				key.escape ||
				back?.some((value) => input === value)
			) {
				// A row armed for removal is disarmed first, staying on the page.
				// Every page taking this key has to see it armed, so it is
				// disarmed only once they all have.
				const { armed, setArmed } = useAppStore.getState();
				if (armed) {
					queueMicrotask(() => setArmed(null));
					return;
				}
				const page = onBack?.();
				if (page === false) return;
				setPage(typeof page === "string" ? page : "chat");
			}
		},
		{ isActive: active },
	);

	return { page, setPage };
};
