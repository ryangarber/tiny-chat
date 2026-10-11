import type { ReactNode } from "react";
import { create } from "zustand";
import type { ContentFormatter } from "#tui/core/components/Content.tsx";
import {
	type Focus,
	selectFocus,
	selectPage,
	useAppStore,
} from "#tui/core/stores/useAppStore.ts";

/** The block drawn over the whole screen, as its `Content` last rendered it. */
interface OpenContent {
	id: string;
	formatter?: ContentFormatter;
	streaming?: boolean;
	children?: ReactNode;
}

interface ContentStore {
	open: OpenContent | null;
	/** Where the focus goes back to once the block is closed. */
	returnFocus: Focus;
	/** Draws a block over the whole screen, which takes the keys. */
	openContent: (content: OpenContent) => void;
	/** Brings the open block up to date with what its `Content` last rendered. */
	updateContent: (content: OpenContent) => void;
	closeContent: () => void;
}

export const useContentStore = create<ContentStore>((set, get) => ({
	open: null,
	returnFocus: "editor",
	openContent: (content) => {
		const app = useAppStore.getState();
		set({ open: content, returnFocus: selectFocus(app) });
		app.setFocus("fullscreen");
	},
	updateContent: (content) => {
		const { open } = get();
		if (
			open?.id !== content.id ||
			(open.formatter === content.formatter &&
				open.streaming === content.streaming &&
				open.children === content.children)
		)
			return;
		set({ open: content });
	},
	closeContent: () => {
		if (!get().open) return;
		set({ open: null });
		// Left already, for somewhere the focus was taken to instead.
		const app = useAppStore.getState();
		if (selectPage(app) === "fullscreen") app.setFocus(get().returnFocus);
	},
}));
