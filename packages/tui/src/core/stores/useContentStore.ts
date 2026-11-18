import type { ReactNode } from "react";
import { create } from "zustand";
import type {
	ContentEdit,
	ContentFormatter,
} from "#tui/core/components/Content.tsx";
import {
	type Focus,
	getFocus,
	getPage,
	useAppStore,
} from "#tui/core/stores/useAppStore.ts";

/** The block drawn over the whole screen, as its `Content` last rendered it. */
interface OpenContent {
	id: string;
	formatter?: ContentFormatter;
	streaming?: boolean;
	findLabel?: string;
	edit?: ContentEdit;
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
		set({ open: content, returnFocus: getFocus() });
		useAppStore.getState().setFocus("fullscreen");
	},
	updateContent: (content) => {
		const { open } = get();
		if (
			open?.id !== content.id ||
			(open.formatter === content.formatter &&
				open.streaming === content.streaming &&
				open.findLabel === content.findLabel &&
				open.edit === content.edit &&
				open.children === content.children)
		)
			return;
		set({ open: content });
	},
	closeContent: () => {
		if (!get().open) return;
		set({ open: null });
		// Left already, for somewhere the focus was taken to instead.
		if (getPage() === "fullscreen")
			useAppStore.getState().setFocus(get().returnFocus);
	},
}));
