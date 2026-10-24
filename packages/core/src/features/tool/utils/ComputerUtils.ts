import type {
	zComputerNode,
	zComputerRect,
} from "#core/features/tool/types/computer.ts";

/** Containers that only arrange their children, unless they are named. */
const LAYOUT_ROLES = new Set([
	"unknown",
	"group",
	"split_group",
	"toolbar",
	"navigation",
]);

/** Roles a person acts on, whether or not the platform lists an action. */
const INTERACTIVE_ROLES = new Set([
	"button",
	"check_box",
	"radio_button",
	"text_field",
	"text_area",
	"combo_box",
	"list_item",
	"menu",
	"menu_item",
	"tab",
	"table_cell",
	"table_row",
	"slider",
	"link",
	"tree_item",
	"switch",
	"spin_button",
	"scroll_bar",
]);

/** States worth showing; the rest are implied by the role or say nothing. */
const SHOWN_STATES = new Set([
	"disabled",
	"focused",
	"selected",
	"checked",
	"mixed",
	"expanded",
	"collapsed",
	"modal",
	"required",
	"busy",
	"minimized",
]);

const KEY_NAMES: Record<string, string> = {
	enter: "enter",
	return: "enter",
	escape: "escape",
	esc: "escape",
	backspace: "backspace",
	tab: "tab",
	space: "space",
	delete: "delete",
	del: "delete",
	insert: "insert",
	arrowup: "up",
	up: "up",
	arrowdown: "down",
	down: "down",
	arrowleft: "left",
	left: "left",
	arrowright: "right",
	right: "right",
	home: "home",
	end: "end",
	pageup: "pageup",
	pagedown: "pagedown",
};

const MODIFIER_NAMES: Record<string, string> = {
	shift: "shift",
	control: "ctrl",
	ctrl: "ctrl",
	alt: "alt",
	option: "alt",
	meta: "meta",
	cmd: "meta",
	command: "meta",
	super: "meta",
	win: "meta",
};

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max)}…` : text;

const quote = (text: string) => `"${text.replace(/"/g, '\\"')}"`;

/** Whitespace-only text says nothing, so it counts as none. */
const text = (value: string | undefined) =>
	value?.replace(/\s+/g, " ").trim() || undefined;

const isHidden = (node: zComputerNode) => !!node.states?.includes("hidden");

export interface ComputerOutlineOptions {
	nodes: zComputerNode[];
	/** The ref an element is shown with, when it gets one. */
	refOf: (node: zComputerNode) => string;
	find?: string;
	maxLength?: number;
}

export const ComputerUtils = {
	/** Whether a node carries what a person could act on. */
	isInteractive: (node: zComputerNode) =>
		!!node.actions?.length ||
		INTERACTIVE_ROLES.has(node.role) ||
		!!node.states?.includes("editable"),

	matches: (node: zComputerNode, find: string) => {
		const needle = find.toLowerCase();
		return [node.role, node.name, node.value, node.description].some((value) =>
			value?.toLowerCase().includes(needle),
		);
	},

	/** Visible nodes matching `find`, for waiting on an element. */
	findAll: (nodes: zComputerNode[], find: string) => {
		const hidden = new Set<number>();
		return nodes.filter((node) => {
			if (isHidden(node) || (node.parent !== null && hidden.has(node.parent))) {
				hidden.add(node.handle);
				return false;
			}
			return ComputerUtils.matches(node, find);
		});
	},

	/**
	 * Where each node sits, as roles and names from the root down, with an
	 * index among same-looking siblings: what a ref is found again by when the
	 * platform gives no stable id. `rootPath` places a subtree read.
	 */
	paths: (nodes: zComputerNode[], rootPath = "") => {
		const paths = new Map<number, string>();
		const seen = new Map<string, number>();
		for (const node of nodes) {
			const parent = node.parent === null ? undefined : paths.get(node.parent);
			if (parent === undefined && rootPath) {
				paths.set(node.handle, rootPath);
				continue;
			}
			const step = `${node.role}:${text(node.name) ?? ""}`;
			const prefix = `${parent ?? ""}/${step}`;
			const index = seen.get(prefix) ?? 0;
			seen.set(prefix, index + 1);
			paths.set(node.handle, `${prefix}#${index}`);
		}
		return paths;
	},

	/**
	 * The window as an indented outline of what a person would see and use,
	 * in the browser tool's format: `- role "name" [state] [ref=e4]: value`.
	 * Layout-only containers are folded into their parents, hidden subtrees
	 * dropped, and only interactive elements get refs.
	 */
	outline: ({
		nodes,
		refOf,
		find,
		maxLength = 20_000,
	}: ComputerOutlineOptions) => {
		const children = new Map<number | null, zComputerNode[]>();
		const byHandle = new Map<number, zComputerNode>();
		for (const node of nodes) {
			byHandle.set(node.handle, node);
			const parent =
				node.parent !== null && byHandle.has(node.parent) ? node.parent : null;
			children.set(parent, [...(children.get(parent) ?? []), node]);
		}

		// With `find`, only matches and the elements that contain them.
		let keep: Set<number> | undefined;
		if (find) {
			keep = new Set();
			for (const match of ComputerUtils.findAll(nodes, find)) {
				for (
					let node: zComputerNode | undefined = match;
					node && !keep.has(node.handle);
					node = node.parent === null ? undefined : byHandle.get(node.parent)
				) {
					keep.add(node.handle);
				}
			}
			if (!keep.size) return `Nothing matches ${quote(find)}.`;
		}

		const lines: string[] = [];
		const render = (node: zComputerNode, depth: number) => {
			if (isHidden(node) || (keep && !keep.has(node.handle))) return;
			const name = text(node.name);
			const value = text(node.value);
			const description = text(node.description);
			const kids = children.get(node.handle) ?? [];
			const interactive = ComputerUtils.isInteractive(node);

			// An empty cell or spacer with nothing to show or do.
			if (
				!name &&
				!value &&
				!kids.length &&
				!node.actions?.length &&
				!node.states?.includes("editable")
			) {
				return;
			}

			const fold =
				!name &&
				!value &&
				!description &&
				!node.actions?.length &&
				(LAYOUT_ROLES.has(node.role) ||
					(!interactive && node.role !== "window" && node.role !== "dialog"));
			if (fold) {
				for (const kid of kids) render(kid, depth);
				return;
			}

			const pad = "  ".repeat(depth);
			if (node.role === "static_text" && !node.actions?.length) {
				const content = name ?? value;
				if (content) lines.push(`${pad}- text: ${clip(content, 400)}`);
				for (const kid of kids) render(kid, depth + 1);
				return;
			}

			let line = `${pad}- ${node.role}`;
			if (name) line += ` ${quote(clip(name, 200))}`;
			for (const state of node.states ?? []) {
				if (SHOWN_STATES.has(state)) line += ` [${state}]`;
			}
			if (description && description !== name) {
				line += ` [description=${quote(clip(description, 200))}]`;
			}
			if (interactive) line += ` [ref=${refOf(node)}]`;
			if (value && value !== name) line += `: ${clip(value, 400)}`;
			else if (kids.length) line += ":";
			lines.push(line);
			for (const kid of kids) render(kid, depth + 1);
		};
		for (const root of children.get(null) ?? []) render(root, 0);

		const outline = lines.join("\n");
		return outline.length > maxLength
			? `${outline.slice(0, maxLength)}\n… ${outline.length - maxLength} more characters; read a narrower ref, use find, or raise maxLength`
			: outline;
	},

	center: (rect: zComputerRect) => ({
		x: Math.round(rect.x + rect.width / 2),
		y: Math.round(rect.y + rect.height / 2),
	}),

	/** `Mod` is Command on macOS and Control elsewhere. */
	modifiers: (names: string[] | undefined, os: string) =>
		(names ?? []).map((name) => {
			const lower = name.toLowerCase();
			if (lower === "mod") return os === "macos" ? "meta" : "ctrl";
			const modifier = MODIFIER_NAMES[lower];
			if (!modifier) throw new Error(`Unknown modifier: ${name}`);
			return modifier;
		}),

	/**
	 * `"Control+A Backspace"` as chords for the host library: canonical key
	 * names, lowercase characters, and Shift held for capitals.
	 */
	parseKeys: (keys: string, os: string) =>
		keys
			.split(/\s+/)
			.filter(Boolean)
			.map((chord) => {
				// `+` alone, or as the last key of a chord (`Control++`).
				const parts = chord.split(/\+(?!$)/);
				const name = parts.pop() ?? "";
				const modifiers = ComputerUtils.modifiers(parts, os);
				const lower = name.toLowerCase();
				let key = KEY_NAMES[lower] ?? MODIFIER_NAMES[lower];
				if (!key && /^f([1-9]|1\d|2[0-4])$/.test(lower)) key = lower;
				if (!key && [...name].length === 1) {
					key = lower;
					// A capital on its own is typed with Shift; in a chord
					// (`Control+A`) the letter only names the key.
					if (name !== lower && !modifiers.length) modifiers.push("shift");
				}
				if (!key) {
					throw new Error(
						`Unknown key: ${name}. Use a type step for text and symbols.`,
					);
				}
				return { key, modifiers };
			}),
} as const;
