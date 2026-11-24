import { defaultFocusManager } from "better-ink-ui";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import {
	type Panel,
	useLayoutStore,
} from "#client/core/stores/useLayoutStore.ts";

export type Page =
	| "chat"
	| "config"
	| "settings"
	| "uploads"
	| "github"
	| "memories"
	| "actions"
	| "console"
	/** A block of content opened over the whole screen. */
	| "fullscreen";

export type { Panel };

/**
 * What takes the keys in turn on the chat page, Tab moving between them: the
 * editor, a tool call waiting on feedback, an open panel, or a find bar.
 */
export type Focusable = "editor" | `tool:${string}` | Panel | `find:${string}`;

/** What takes the keys: a page over the chat, or one focusable on it. */
export type Focus = Exclude<Page, "chat"> | Focusable;

const isFocusable = (focus: Focus): focus is Focusable =>
	focus === "editor" ||
	focus === "chats" ||
	focus === "files" ||
	focus.startsWith("tool:") ||
	focus.startsWith("find:");

/** Tab order, whatever order they turned up on screen in: a focus target's `order`. */
export const focusOrder = (focusable: Focusable) =>
	focusable === "editor"
		? 0
		: focusable.startsWith("tool:")
			? 1
			: focusable === "chats"
				? 2
				: focusable === "files"
					? 3
					: 4;

export interface Status {
	id: string;
	text?: string | null;
	/**
	 * A status that reports rather than holds things up: it is shown without a
	 * spinner, and leaves the editor usable while it stands.
	 */
	passive?: boolean;
}

/**
 * Where the keys go. The focusables register themselves as they are drawn
 * (`Panel`, the find bar), the editor as the sink the focus falls back to once
 * the one that had it leaves the screen; each page registers as it opens.
 * The library's default manager, so targets drawn outside of `App`'s provider
 * — a panel rendered on its own in a test — are on it all the same.
 */
export const focusManager = defaultFocusManager;

/**
 * The focus as it stands. A page has it from the moment it is asked for, as it
 * is drawn for as long as it is; a focusable once it is on screen, and until
 * then — or once it has left, a panel closed or a tool call answered — the
 * editor does. Asked for again, a panel that only moved (between the sidebar
 * and below the chat) has it back.
 */
export const getFocus = (): Focus => {
	const requested = focusManager.requestedId() as Focus | null;
	if (requested && !isFocusable(requested)) return requested;
	return (focusManager.focused() ?? "editor") as Focus;
};

/**
 * The page drawn, which is the chat for anything focusable on it — but for the
 * find bar of the block opened over the screen, which is drawn on the page it
 * searches. Read from the focus asked for, so a bar opened on that page keeps
 * it up while it is still being drawn.
 */
export const getPage = (): Page => {
	const requested = focusManager.requestedId() as Focus | null;
	if (requested === "find:fullscreen") return "fullscreen";
	return requested && !isFocusable(requested) ? requested : "chat";
};

export const useFocus = () =>
	useSyncExternalStore(focusManager.subscribe, getFocus, getFocus);

export const useCurrentPage = () =>
	useSyncExternalStore(focusManager.subscribe, getPage, getPage);

/** Whether a focusable has the focus, for something drawn outside of it. */
export const useFocused = (focusable: Focusable) => {
	const get = () => getFocus() === focusable;
	return useSyncExternalStore(focusManager.subscribe, get, get);
};

interface AppStore {
	/** Asks for the focus on a page or a focusable, through `focusManager`. */
	setFocus: (focus: Focus) => void;

	/** Open and close the panels in `useLayoutStore`, moving the focus with them. */
	togglePanel: (panel: Panel) => void;
	openPanel: (panel: Panel) => void;
	closePanel: (panel: Panel) => void;

	/** Whether the chats panel lists the projects in place of the chats. */
	pickingProject: boolean;
	setPickingProject: (pickingProject: boolean) => void;

	/**
	 * The row a first `d` armed for removal, which a second puts through. Kept
	 * here so that going back cancels it rather than leaving the page.
	 */
	armed: { list: string; value: string } | null;
	setArmed: (armed: { list: string; value: string } | null) => void;

	/** Opens the memories or actions page on the one with `id`, kept in `useLayoutStore`. */
	openRecord: (page: "memories" | "actions", id: string) => void;
	clearRecord: () => void;

	statuses: Status[];
	setStatus: (status: Status) => void;
	unsetStatus: (status: { id: string }) => void;

	workingStatus: Set<string>;
	setWorkingStatus: (id: string) => void;
	unsetWorkingStatus: (id: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
	setFocus: (focus) => focusManager.focus(focus),

	togglePanel: (panel) => {
		const { panels, setPanel } = useLayoutStore.getState();
		setPanel(panel, !panels[panel]);
		if (!panels[panel]) focusManager.focus(panel);
		else if (getFocus() === panel) focusManager.focus("editor");
	},
	openPanel: (panel) => {
		useLayoutStore.getState().setPanel(panel, true);
		focusManager.focus(panel);
	},
	closePanel: (panel) => {
		useLayoutStore.getState().setPanel(panel, false);
		if (getFocus() === panel) focusManager.focus("editor");
	},

	pickingProject: false,
	setPickingProject: (pickingProject) => set({ pickingProject }),

	armed: null,
	setArmed: (armed) => set({ armed }),

	openRecord: (page, id) => {
		useLayoutStore.getState().setRecord(id);
		focusManager.focus(page);
	},
	clearRecord: () => useLayoutStore.getState().setRecord(null),

	statuses: [],
	setStatus: (status: Status) => {
		set(({ statuses }) => {
			return {
				statuses: [
					...statuses.filter((other) => other.id !== status.id),
					status,
				],
			};
		});
	},
	unsetStatus: ({ id }) => {
		set((state) => {
			return { statuses: state.statuses.filter((s) => s.id !== id) };
		});
	},

	workingStatus: new Set(),
	setWorkingStatus: (id: string) => {
		set(({ workingStatus }) => {
			workingStatus.add(id);
			return { workingStatus };
		});
	},
	unsetWorkingStatus: (id: string) => {
		set(({ workingStatus }) => {
			workingStatus.delete(id);
			return { workingStatus };
		});
	},
}));
