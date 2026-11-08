import {
	type TerminalCell,
	type TerminalMatch,
	type TerminalStyle,
	zTerminalMatch,
} from "#core/features/tool/types/terminal.ts";

const NAMES = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
];

const hex = (r: number, g: number, b: number) =>
	`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** A palette index as matches name it: the first 16 by name, the rest as xterm draws them. */
const indexed = (n: number) => {
	if (n < 8) return NAMES[n];
	if (n < 16) return `bright${NAMES[n - 8]}`;
	if (n < 232) {
		const level = (v: number) => (v ? 55 + v * 40 : 0);
		const i = n - 16;
		return hex(
			level(Math.floor(i / 36)),
			level(Math.floor(i / 6) % 6),
			level(i % 6),
		);
	}
	const v = 8 + (n - 232) * 10;
	return hex(v, v, v);
};

const DEFAULT_STYLE: TerminalStyle = {
	fg: "default",
	bg: "default",
	bold: false,
	dim: false,
	italic: false,
	underline: false,
	inverse: false,
};

/** Reads `38;5;n` or `38;2;r;g;b` from `params` at `i`, saying how many it used. */
const extended = (
	params: number[],
	i: number,
): [string | undefined, number] => {
	if (params[i + 1] === 5) return [indexed(params[i + 2] ?? 0), 3];
	if (params[i + 1] === 2)
		return [hex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0), 5];
	return [undefined, 1];
};

const applySgr = (style: TerminalStyle, raw: string): TerminalStyle => {
	const next = { ...style };
	const params =
		raw === "" ? [0] : raw.split(/[;:]/).map((p) => Number(p) || 0);
	for (let i = 0; i < params.length; ) {
		const p = params[i];
		if (p === 38 || p === 48 || p === 58) {
			const [color, used] = extended(params, i);
			if (color && p === 38) next.fg = color;
			if (color && p === 48) next.bg = color;
			i += used;
			continue;
		}
		if (p === 0) Object.assign(next, DEFAULT_STYLE);
		else if (p === 1) next.bold = true;
		else if (p === 2) next.dim = true;
		else if (p === 3) next.italic = true;
		else if (p === 4) next.underline = true;
		else if (p === 7) next.inverse = true;
		else if (p === 21) next.underline = true;
		else if (p === 22) next.bold = next.dim = false;
		else if (p === 23) next.italic = false;
		else if (p === 24) next.underline = false;
		else if (p === 27) next.inverse = false;
		else if (p >= 30 && p <= 37) next.fg = NAMES[p - 30];
		else if (p === 39) next.fg = "default";
		else if (p >= 40 && p <= 47) next.bg = NAMES[p - 40];
		else if (p === 49) next.bg = "default";
		else if (p >= 90 && p <= 97) next.fg = `bright${NAMES[p - 90]}`;
		else if (p >= 100 && p <= 107) next.bg = `bright${NAMES[p - 100]}`;
		i++;
	}
	return next;
};

/** Columns a code point takes: 0 for marks and joiners, 2 for wide ones. */
const widthOf = (char: string) => {
	const cp = char.codePointAt(0) ?? 0;
	if (
		cp < 0x20 ||
		/\p{M}/u.test(char) ||
		(cp >= 0x200b && cp <= 0x200f) ||
		cp === 0x2060 ||
		(cp >= 0xfe00 && cp <= 0xfe0f)
	)
		return 0;
	if (
		/\p{Emoji_Presentation}/u.test(char) ||
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	)
		return 2;
	return 1;
};

const blank = (cell: TerminalCell) => !cell.char.trim();

/** `Bright Red`, `bright-red` and `#FF0000` as cells spell them. */
const normalizeColor = (color: string) => {
	const value = color.trim().toLowerCase();
	if (/^#[0-9a-f]{3}$/.test(value))
		return `#${[...value.slice(1)].map((c) => c + c).join("")}`;
	return value.replace(/[\s_-]/g, "");
};

/** Whether a cell looks as the match asks; blank cells only answer for their background. */
const styled = (cell: TerminalCell, match: TerminalMatch) => {
	const check = <K extends keyof TerminalStyle>(key: K) =>
		match[key] === undefined ||
		(key === "fg" || key === "bg"
			? normalizeColor(String(match[key])) === cell[key]
			: match[key] === cell[key]);
	if (!check("bg") || !check("inverse")) return false;
	if (blank(cell)) return true;
	return (["fg", "bold", "dim", "italic", "underline"] as const).every(check);
};

const STYLE_KEYS = [
	"fg",
	"bg",
	"bold",
	"dim",
	"italic",
	"underline",
	"inverse",
] as const;

export interface TerminalFound {
	row: number;
	col: number;
	/** Columns it spans. */
	width: number;
	text: string;
}

export const TerminalUtils = {
	/**
	 * Cells from `capture-pane -e` output: one row per line, styled by its SGR
	 * sequences, with other escapes (hyperlinks, say) dropped. A wide character
	 * is followed by an empty cell, so columns line up with the screen's.
	 */
	parse: (captured: string): TerminalCell[][] => {
		const rows: TerminalCell[][] = [];
		let style = { ...DEFAULT_STYLE };
		const pattern =
			// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences
			/\x1b\[([0-9;:?]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|([^\x1b])/gsu;
		const lines = captured.replace(/\n$/, "").split("\n");
		for (const line of lines) {
			const row: TerminalCell[] = [];
			for (const [, params, final, char] of line.matchAll(pattern)) {
				if (final === "m") style = applySgr(style, params ?? "");
				if (char === undefined || char === "\r") continue;
				const width = widthOf(char);
				const last = row.at(-1);
				if (width === 0) {
					if (last) last.char += char;
					continue;
				}
				row.push({ ...style, char });
				if (width === 2) row.push({ ...style, char: "" });
			}
			rows.push(row);
		}
		return rows;
	},

	/** A row's text, trailing blanks trimmed. */
	text: (row: TerminalCell[]) =>
		row
			.map((cell) => cell.char)
			.join("")
			.trimEnd(),

	/**
	 * Everything on screen the match describes, top to bottom. Rows are
	 * numbered from `top` (1 unless scrollback is included above).
	 */
	find: (
		rows: TerminalCell[][],
		match: TerminalMatch,
		top = 1,
	): TerminalFound[] => {
		const found: TerminalFound[] = [];
		const pattern =
			match.regex !== undefined
				? new RegExp(match.regex, "gu")
				: match.text !== undefined
					? new RegExp(match.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu")
					: undefined;

		for (const [index, cells] of rows.entries()) {
			const row = top + index;
			if (match.row !== undefined && match.row !== row) continue;

			if (!pattern) {
				// A cell by its place, or each run of cells in the style asked for.
				if (match.col !== undefined) {
					const cell = cells[match.col - 1] ?? { ...DEFAULT_STYLE, char: " " };
					if (styled(cell, match))
						found.push({ row, col: match.col, width: 1, text: cell.char });
					continue;
				}
				let start = -1;
				for (let i = 0; i <= cells.length; i++) {
					const ok = i < cells.length && styled(cells[i], match);
					if (ok && start < 0 && !blank(cells[i])) start = i;
					if (!ok && start >= 0) {
						let end = i;
						while (end > start && blank(cells[end - 1])) end--;
						found.push({
							row,
							col: start + 1,
							width: end - start,
							text: cells
								.slice(start, end)
								.map((cell) => cell.char)
								.join(""),
						});
						start = -1;
					}
				}
				continue;
			}

			// Each character of the text, by the column it starts in.
			let text = "";
			const columns: number[] = [];
			for (const [col, cell] of cells.entries()) {
				for (let i = 0; i < cell.char.length; i++) columns.push(col);
				text += cell.char;
			}
			columns.push(cells.length);

			for (const result of text.matchAll(pattern)) {
				if (!result[0]) continue;
				const start = columns[result.index] ?? 0;
				const end = columns[result.index + result[0].length] ?? cells.length;
				if (match.col !== undefined && match.col !== start + 1) continue;
				if (!cells.slice(start, end).every((cell) => styled(cell, match)))
					continue;
				found.push({
					row,
					col: start + 1,
					width: Math.max(1, end - start),
					text: result[0],
				});
			}
		}
		return found;
	},

	/** The match a step describes, out of everything else it says. */
	match: (step: TerminalMatch): TerminalMatch =>
		Object.fromEntries(
			(Object.keys(zTerminalMatch) as (keyof TerminalMatch)[])
				.filter((key) => step[key] !== undefined)
				.map((key) => [key, step[key]]),
		),

	/** Whether the match says what to look for, rather than nothing at all. */
	isMatch: (match: TerminalMatch) =>
		(Object.keys(zTerminalMatch) as (keyof TerminalMatch)[]).some(
			(key) => match[key] !== undefined,
		),

	/** `"Ready" in red on row 3`, for errors. */
	describe: (match: TerminalMatch) => {
		const what =
			match.text !== undefined
				? JSON.stringify(match.text)
				: match.regex !== undefined
					? `/${match.regex}/`
					: match.col !== undefined && match.row !== undefined
						? `the cell at ${match.row}:${match.col}`
						: "text";
		const style = STYLE_KEYS.filter((key) => match[key] !== undefined).map(
			(key) =>
				typeof match[key] === "boolean"
					? `${match[key] ? "" : "not "}${key}`
					: `${key} ${match[key]}`,
		);
		const where = [
			match.row !== undefined && match.text !== undefined
				? `on row ${match.row}`
				: "",
			match.col !== undefined && match.text !== undefined
				? `at column ${match.col}`
				: "",
		].filter(Boolean);
		return [
			what,
			...(style.length ? [`(${style.join(", ")})`] : []),
			...where,
		].join(" ");
	},

	/**
	 * Runs of text whose style is not the default, row by row: what a reader
	 * would otherwise only see as color.
	 */
	styles: (rows: TerminalCell[][], top = 1, limit = 400) => {
		const runs: Record<string, unknown>[] = [];
		for (const [index, cells] of rows.entries()) {
			let start = 0;
			for (let i = 1; i <= cells.length; i++) {
				const same =
					i < cells.length &&
					STYLE_KEYS.every((key) => cells[i][key] === cells[start][key]);
				if (same) continue;
				const cell = cells[start];
				const style = Object.fromEntries(
					STYLE_KEYS.filter((key) => cell[key] !== DEFAULT_STYLE[key]).map(
						(key) => [key, cell[key]],
					),
				);
				const text = cells
					.slice(start, i)
					.map((c) => c.char)
					.join("");
				if (
					Object.keys(style).length &&
					(text.trim() || style.bg || style.inverse)
				)
					runs.push({ row: top + index, col: start + 1, text, ...style });
				start = i;
			}
			if (runs.length >= limit) break;
		}
		return runs.slice(0, limit);
	},

	/**
	 * A key as tmux's `send-keys` names it: `Control+Shift+Tab` → `C-BTab`,
	 * `Alt+Enter` → `M-Enter`. tmux's own names pass through.
	 */
	key: (token: string): string => {
		const parts =
			token === "+"
				? ["+"]
				: token.endsWith("++")
					? [...token.slice(0, -2).split("+"), "+"]
					: token.split("+");
		const name = parts.pop() ?? "";
		const modifiers = new Set<string>(
			parts.map((part) => {
				const value = part.toLowerCase();
				if (["control", "ctrl", "ctl", "c"].includes(value)) return "C-";
				if (["alt", "option", "opt", "meta", "m"].includes(value)) return "M-";
				if (["shift", "s"].includes(value)) return "S-";
				throw new Error(`Unknown modifier "${part}" in "${token}"`);
			}),
		);
		const named: Record<string, string> = {
			enter: "Enter",
			return: "Enter",
			tab: "Tab",
			escape: "Escape",
			esc: "Escape",
			backspace: "BSpace",
			bspace: "BSpace",
			delete: "DC",
			del: "DC",
			insert: "IC",
			up: "Up",
			down: "Down",
			left: "Left",
			right: "Right",
			arrowup: "Up",
			arrowdown: "Down",
			arrowleft: "Left",
			arrowright: "Right",
			home: "Home",
			end: "End",
			pageup: "PPage",
			pgup: "PPage",
			pagedown: "NPage",
			pgdn: "NPage",
			space: "Space",
		};
		let key = named[name.toLowerCase()] ?? name;
		if (/^f([1-9]|1[0-2])$/i.test(key)) key = key.toUpperCase();
		if (modifiers.has("S-") && key === "Tab") {
			modifiers.delete("S-");
			key = "BTab";
		} else if (modifiers.has("S-") && /^[a-z]$/.test(key)) {
			modifiers.delete("S-");
			key = key.toUpperCase();
		}
		const prefix = ["C-", "M-", "S-"].filter((m) => modifiers.has(m)).join("");
		return TerminalUtils.arg(prefix + key);
	},

	/**
	 * An argument tmux reads as it is: one ending in `;` would otherwise end
	 * the command there.
	 */
	arg: (value: string) =>
		value.endsWith(";") ? `${value.slice(0, -1)}\\;` : value,

	/**
	 * The bytes a terminal sends for a mouse event, in whichever encoding the
	 * program asked for: SGR (`ESC [ < b ; x ; y M`) or the original X10 one.
	 */
	mouse: ({
		sgr,
		button,
		col,
		row,
		release = false,
		motion = false,
		modifiers = [],
	}: {
		sgr: boolean;
		/** 0 left, 1 middle, 2 right, 64–67 the wheel. */
		button: number;
		col: number;
		row: number;
		release?: boolean;
		motion?: boolean;
		modifiers?: string[];
	}): number[] => {
		let code = button;
		if (modifiers.includes("Shift")) code += 4;
		if (modifiers.includes("Alt")) code += 8;
		if (modifiers.includes("Control")) code += 16;
		if (motion) code += 32;
		if (sgr) {
			const sequence = `\x1b[<${code};${col};${row}${release ? "m" : "M"}`;
			return [...sequence].map((c) => c.charCodeAt(0));
		}
		if (release) code = (code & ~3) | 3;
		const byte = (v: number) => Math.min(255, 32 + v);
		return [0x1b, 0x5b, 0x4d, byte(code), byte(col), byte(row)];
	},
} as const;
