import { stripVTControlCharacters } from "node:util";
import { type DOMElement, measureElement } from "ink";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import type { MousePoint } from "#tui/core/utils/MouseUtils.ts";

type DOMNode = DOMElement["childNodes"][number];

/** A run of a block's text, from `start` to `end` in it. */
export interface TextPiece {
	node: DOMElement;
	start: number;
	end: number;
}

/** A row of a piece as drawn, placed in cells from an element's content box. */
export interface TextRow {
	x: number;
	y: number;
	text: string;
}

/** Where each character of a block's text is drawn, once Ink has wrapped it. */
export interface TextLayout {
	x: number;
	y: number;
	/** By index into the block's text; a character wrapping dropped sits where it would have. */
	cells: { line: number; column: number }[];
	/** Columns past which a truncated block draws nothing. */
	maxWidth: number;
	truncated: boolean;
}

/** The text a node shows, as Ink squashes it before styling it. */
const textOf = (node: DOMNode): string => {
	if (node.nodeName === "#text") return node.nodeValue;
	if (node.isHidden) return "";
	return node.childNodes.map(textOf).join("");
};

/**
 * Walks `text` alongside `wrapped`, which only differs from it by the line
 * breaks wrapping added and the spaces it broke on.
 */
const cellsOf = (text: string, wrapped: string) => {
	const cells: TextLayout["cells"] = [];
	let line = 0;
	let column = 0;
	let j = 0;
	for (let i = 0; i < text.length; ) {
		// biome-ignore lint/style/noNonNullAssertion: i is within text
		const character = String.fromCodePoint(text.codePointAt(i)!);
		if (wrapped.startsWith(character, j)) {
			for (let k = 0; k < character.length; k++)
				cells[i + k] = { line, column };
			if (character === "\n") {
				line++;
				column = 0;
			} else column += stringWidth(character);
			i += character.length;
			j += character.length;
		} else if (wrapped[j] === "\n") {
			j++;
			line++;
			column = 0;
		} else {
			cells[i] = { line, column };
			i++;
		}
	}
	return cells;
};

/** The box an ancestor clips its content to, if it clips at all. */
const clipOf = (node: DOMElement) => {
	const { overflow, overflowX, overflowY } = node.style;
	const clipX = (overflowX ?? overflow) === "hidden";
	const clipY = (overflowY ?? overflow) === "hidden";
	if (!clipX && !clipY) return null;
	const { x, y, width, height } = measureElement(node);
	return {
		left: clipX ? x : Number.NEGATIVE_INFINITY,
		right: clipX ? x + width : Number.POSITIVE_INFINITY,
		top: clipY ? y : Number.NEGATIVE_INFINITY,
		bottom: clipY ? y + height : Number.POSITIVE_INFINITY,
	};
};

/** Whether a row of cells is drawn rather than clipped by a view it sits in. */
const isVisible = (
	node: DOMElement,
	root: DOMElement,
	{ x, y, width }: { x: number; y: number; width: number },
) => {
	for (let parent = node.parentNode; parent; parent = parent.parentNode) {
		const clip = clipOf(parent);
		if (
			clip &&
			(y < clip.top ||
				y >= clip.bottom ||
				x < clip.left ||
				x + width > clip.right)
		)
			return false;
		if (parent === root) break;
	}
	return true;
};

/** Where the content box of an element starts, inside its border. */
const originOf = (root: DOMElement) => {
	const origin = measureElement(root);
	const borderLeft = root.style.borderStyle && root.style.borderLeft !== false;
	const borderTop = root.style.borderStyle && root.style.borderTop !== false;
	return {
		x: origin.x + (borderLeft ? 1 : 0),
		y: origin.y + (borderTop ? 1 : 0),
	};
};

/** What is drawn but never read as text: line numbers beside code, buttons. */
const ignored = new WeakSet<DOMElement>();

/**
 * Text as Ink draws it: the blocks of it under an element, and where each of
 * their characters lands once wrapped, in the coordinates {@link measureElement}
 * reports — from the top left of Ink's own output rather than the screen.
 */
export const TextLayoutUtils = {
	/**
	 * A ref for what is drawn beside text but is not part of it, such as line
	 * numbers, which is never found or selected.
	 */
	ignore: (node: DOMElement | null) => {
		if (node) ignored.add(node);
	},

	/**
	 * A block's text with tabs expanded, which Ink does before measuring it,
	 * and without the escapes text styled ahead of time — code — carries.
	 */
	text: (node: DOMElement) => {
		const text = stripVTControlCharacters(textOf(node)).replaceAll(
			"\r\n",
			"\n",
		);
		return text.includes("\t")
			? wrapAnsi(text, Number.POSITIVE_INFINITY, { trim: false })
			: text;
	},

	/**
	 * Every block of text drawn under `root` — each `<Text>` holding inline
	 * text nested in it — skipping what is hidden or ignored, and whatever is
	 * under `skip`.
	 */
	*blocks(
		root: DOMElement,
		skip: (DOMElement | null)[] = [],
	): Generator<DOMElement> {
		if (
			skip.includes(root) ||
			ignored.has(root) ||
			root.style.display === "none"
		)
			return;
		if (root.nodeName === "ink-text") {
			yield root;
			return;
		}
		for (const child of root.childNodes)
			if (child.nodeName !== "#text")
				yield* TextLayoutUtils.blocks(child, skip);
	},

	/** Lays a block out the way Ink's renderer does, from the layout it computed. */
	layout: (node: DOMElement): TextLayout | null => {
		if (!node.yogaNode) return null;
		const { x, y, width } = measureElement(node);
		const text = TextLayoutUtils.text(node);
		const textWrap = node.style.textWrap ?? "wrap";
		const fits = text.split("\n").every((line) => stringWidth(line) <= width);
		const truncated = !fits && textWrap.startsWith("truncate");
		const wrapped =
			fits || truncated
				? text
				: wrapAnsi(text, Math.max(1, width), {
						trim: false,
						hard: true,
						wordWrap: textWrap === "wrap",
					});
		return { x, y, cells: cellsOf(text, wrapped), maxWidth: width, truncated };
	},

	/**
	 * Where pieces of text are drawn, row by row, relative to the content box of
	 * `root` — where a child of it positioned absolutely at the same offsets
	 * covers them. Rows a view has scrolled out of sight are left out.
	 */
	rows: (root: DOMElement, pieces: TextPiece[]) => {
		const origin = originOf(root);
		const layouts = new Map<DOMElement, TextLayout | null>();
		const rows: (TextRow & { piece: number })[] = [];

		pieces.forEach(({ node, start, end }, index) => {
			if (!layouts.has(node)) layouts.set(node, TextLayoutUtils.layout(node));
			const layout = layouts.get(node);
			if (!layout) return;
			const text = TextLayoutUtils.text(node);

			// One row per line the piece is drawn across.
			let row: {
				line: number;
				column: number;
				from: number;
				to: number;
			} | null = null;
			const flush = () => {
				if (!row) return;
				const segment = text.slice(row.from, row.to);
				const width = stringWidth(segment);
				const cell = {
					x: layout.x + row.column,
					y: layout.y + row.line,
					width,
				};
				const clipped =
					layout.truncated && row.column + width > layout.maxWidth;
				if (segment && !clipped && isVisible(node, root, cell))
					rows.push({
						x: cell.x - origin.x,
						y: cell.y - origin.y,
						text: segment,
						piece: index,
					});
				row = null;
			};
			for (let i = start; i < end; i++) {
				const cell = layout.cells[i];
				if (!cell || text[i] === "\n") {
					flush();
					continue;
				}
				if (row && cell.line !== row.line) flush();
				if (!row) row = { ...cell, from: i, to: i };
				row.to = i + 1;
			}
			flush();
		});

		return rows;
	},

	/**
	 * The offset into a block's text that a point lands on: the character drawn
	 * under it, or past the end of a line it is to the right of. Anything before
	 * the block's first row is its start, and after its last row its end.
	 */
	offset: (layout: TextLayout, text: string, { x, y }: MousePoint) => {
		let offset = 0;
		for (let i = 0; i < text.length; i++) {
			const cell = layout.cells[i];
			if (!cell) continue;
			const cellY = layout.y + cell.line;
			const cellX = layout.x + cell.column;
			if (cellY > y) break;
			if (cellY === y) {
				// A line break stands for every cell past the end of its line.
				if (text[i] === "\n" && x >= cellX) return i;
				if (x < cellX + Math.max(1, stringWidth(text[i]))) {
					if (x >= cellX) return i;
					return offset;
				}
			}
			offset = i + 1;
		}
		return offset;
	},

	/** Where the character at an offset into a block's text is drawn. */
	point: (layout: TextLayout, text: string, offset: number): MousePoint => {
		const cell = layout.cells[offset];
		if (cell) return { x: layout.x + cell.column, y: layout.y + cell.line };
		// Past the end, it is drawn after the last character.
		const last = layout.cells[text.length - 1];
		if (!last) return { x: layout.x, y: layout.y };
		return text.endsWith("\n")
			? { x: layout.x, y: layout.y + last.line + 1 }
			: {
					x: layout.x + last.column + stringWidth(text.at(-1) ?? ""),
					y: layout.y + last.line,
				};
	},

	/** Where the content box of `root` starts, in the coordinates layouts use. */
	origin: originOf,
} as const;
