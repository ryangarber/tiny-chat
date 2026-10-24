import { create } from "zustand";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";

/**
 * A source to preview in the chat's sources, by the path a source chip gives
 * it: a file's own, or `web:`, `memory:` or `action:` and its URL or ID.
 */
export interface ViewedFile {
	path: string;
	web?: zWebContext;
	directory: boolean;
	chatId: string | null;
}

interface ChatSourcesStore {
	viewedFile: ViewedFile | null;
	/** Opens the sources on `file`, which they select and preview. */
	viewFile: (file: ViewedFile | null) => void;
}

export const useChatSourcesStore = create<ChatSourcesStore>((set) => ({
	viewedFile: null,
	viewFile: (viewedFile) => {
		set({ viewedFile });
		if (viewedFile) useLayoutStore.getState().setPanel("files", true);
	},
}));
