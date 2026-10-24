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

/** Tab order, whatever order they turned up on screen in. */
const rank = (focusable: Focusable) =>
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

interface AppStore {
	/** Read through `selectFocus`, which accounts for focusables gone from the screen. */
	focus: Focus;
	setFocus: (focus: Focus) => void;
	/** The focusables on screen, in Tab order. */
	focusables: Focusable[];
	addFocusable: (focusable: Focusable) => void;
	removeFocusable: (focusable: Focusable) => void;
	cycleFocus: (direction: 1 | -1) => void;

	/** Open and close the panels in `useLayoutStore`, moving the focus with them. */
	togglePanel: (panel: Panel) => void;
	openPanel: (panel: Panel) => void;
	closePanel: (panel: Panel) => void;

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

/**
 * The focus as it stands. One that has left the screen — a panel closed, a
 * tool call answered — falls back to the editor; kept rather than reset, a
 * panel that only moved (between the sidebar and below the chat) keeps it.
 */
export const selectFocus = ({ focus, focusables }: AppStore): Focus =>
	!isFocusable(focus) || focusables.includes(focus) ? focus : "editor";

/**
 * The page the focus is on, which is the chat for anything focusable on it —
 * but for the find bar of the block opened over the screen, which is drawn on
 * the page it searches.
 */
export const selectPage = (state: AppStore): Page => {
	const focus = selectFocus(state);
	if (focus === "find:fullscreen") return "fullscreen";
	return isFocusable(focus) ? "chat" : focus;
};

export const useAppStore = create<AppStore>((set) => ({
	focus: "editor",
	setFocus: (focus) => set({ focus }),
	focusables: [],
	addFocusable: (focusable) =>
		set(({ focusables }) =>
			focusables.includes(focusable)
				? {}
				: {
						focusables: [...focusables, focusable].sort(
							(a, b) => rank(a) - rank(b),
						),
					},
		),
	removeFocusable: (focusable) =>
		set(({ focusables }) => ({
			focusables: focusables.filter((other) => other !== focusable),
		})),
	cycleFocus: (direction) =>
		set((state) => {
			const { focusables } = state;
			if (!focusables.length) return {};
			const focus = selectFocus(state);
			const index = isFocusable(focus) ? focusables.indexOf(focus) : -1;
			return {
				focus:
					focusables[
						(index + direction + focusables.length) % focusables.length
					],
			};
		}),

	togglePanel: (panel) => {
		const { panels, setPanel } = useLayoutStore.getState();
		setPanel(panel, !panels[panel]);
		set(({ focus }) => ({
			focus: panels[panel] ? (focus === panel ? "editor" : focus) : panel,
		}));
	},
	openPanel: (panel) => {
		useLayoutStore.getState().setPanel(panel, true);
		set({ focus: panel });
	},
	closePanel: (panel) => {
		useLayoutStore.getState().setPanel(panel, false);
		set(({ focus }) => ({ focus: focus === panel ? "editor" : focus }));
	},

	armed: null,
	setArmed: (armed) => set({ armed }),

	openRecord: (page, id) => {
		useLayoutStore.getState().setRecord(id);
		set({ focus: page });
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
