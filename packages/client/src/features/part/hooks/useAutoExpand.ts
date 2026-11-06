import { createContext, useCallback, useContext } from "react";
import { useExpandStore } from "#client/features/part/stores/useExpandStore.ts";

/**
 * Where something that opens is drawn: the message it is in, and the call a
 * nested conversation is shown inside of. Part ids are only unique where they
 * are drawn — a provider numbers a reply's thoughts `0`, `1`, … afresh for
 * every reply, and some number their calls the same way — so what the user
 * opens is remembered under the scope too, rather than opening whatever shares
 * its id in another chat or another reply.
 */
export const ExpandScopeContext = createContext("");

/** The scope to provide to `ExpandScopeContext` for something drawn inside `id`. */
export const useExpandScope = (id: string | undefined) => {
	const parent = useContext(ExpandScopeContext);
	return id === undefined ? parent : `${parent}/${id}`;
};

/** `key` as it is remembered, in the scope it is drawn in. */
export const useExpandKey = (key: string) =>
	`${useContext(ExpandScopeContext)}:${key}`;

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
	const scoped = useExpandKey(key);
	const override = useExpandStore((state) => state.overrides[scoped]);
	const setOverride = useExpandStore((state) => state.setOverride);

	const expanded = override ?? (active || revealed);
	const auto = override === undefined && active;

	const toggle = useCallback(() => {
		setOverride(scoped, !expanded);
	}, [scoped, expanded, setOverride]);

	return { expanded, auto, toggle };
};

/**
 * Whether the user opened any of `keys` themselves, in the scope they are
 * drawn in — for a run of calls to stay open around a call opened in it.
 */
export const useAnyExpanded = (keys: string[]) => {
	const scope = useContext(ExpandScopeContext);
	return useExpandStore((state) =>
		keys.some((key) => state.overrides[`${scope}:${key}`] === true),
	);
};
