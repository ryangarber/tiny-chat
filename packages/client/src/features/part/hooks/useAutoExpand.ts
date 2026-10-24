import { useCallback } from "react";
import { useExpandStore } from "#client/features/part/stores/useExpandStore.ts";

/**
 * Open while `active`, closed once it settles — unless the user has opened or
 * closed it themselves, which then holds, even across it being unmounted and
 * mounted again under the same `key`. `auto` is true while it is open only
 * because it is active, so the content can be held to a height that follows
 * its newest lines.
 *
 * `revealed` opens it the way `active` does, for find showing a match in it.
 */
export const useAutoExpand = (
	key: string,
	active: boolean,
	revealed = false,
) => {
	const override = useExpandStore((state) => state.overrides[key]);
	const setOverride = useExpandStore((state) => state.setOverride);

	const expanded = override ?? (active || revealed);
	const auto = override === undefined && active;

	const toggle = useCallback(() => {
		setOverride(key, !expanded);
	}, [key, expanded, setOverride]);

	return { expanded, auto, toggle };
};
