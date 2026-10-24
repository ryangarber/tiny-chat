import { useContext, useLayoutEffect } from "react";
import { ClientContext } from "#client/client.ts";
import {
	type Panel,
	useLayoutStore,
} from "#client/core/stores/useLayoutStore.ts";

const STORAGE_KEY = "panels";

/**
 * Restores which panels were open, and keeps them for next time. Mounted once,
 * by the app or the CLI.
 */
export const usePersistedPanels = ({
	restore = true,
}: {
	/** False to start closed, still keeping what is opened from here on. */
	restore?: boolean;
} = {}) => {
	const client = useContext(ClientContext);

	// biome-ignore lint/correctness/useExhaustiveDependencies: restored once, on mount.
	useLayoutEffect(() => {
		const stored =
			client.getStorage<Partial<Record<Panel, boolean>>>(STORAGE_KEY);
		if (restore && stored) {
			const { setPanel } = useLayoutStore.getState();
			for (const panel of ["chats", "files"] as const)
				if (typeof stored[panel] === "boolean") setPanel(panel, stored[panel]);
		}
		return useLayoutStore.subscribe(({ panels }, previous) => {
			if (panels !== previous.panels) client.setStorage(STORAGE_KEY, panels);
		});
	}, [client]);
};
