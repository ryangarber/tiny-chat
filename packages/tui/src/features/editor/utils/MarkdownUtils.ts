import type { ColorScheme } from "#client/core/components/ThemeContext.tsx";
import {
	type Nodes,
	processor,
	type Root,
} from "#client/features/message/hooks/useMarkdown.ts";
import { MarkdownUtils as MessageMarkdownUtils } from "#client/features/message/utils/MarkdownUtils.ts";
import type { CodeResult } from "#core/core/utils/CodeUtils.ts";
import type {
	TextareaEdit,
	TextareaLabels,
	TextareaRange,
	TextareaSelection,
	TextareaStyle,
	TextareaStyles,
} from "#tui/features/textarea/types/textarea.ts";

/**
 * Markdown as it is being written, drawn the way the message it becomes is
 * drawn.
 *
 * The value is read by the very parser a sent message is rendered with, so
 * whatever ends up styled here is exactly what comes out styled there. Every
 * node paints the run of the value it was parsed from, and a node inside
 * another is painted under both — a word that is bold and slanted is drawn
 * bold and slanted. The syntax itself is left standing, set apart under a
 * marker style of its own.
 */

/** The labels the markdown is painted under, each with a style below. */
const LABEL = {
	code: "markdownCode",
	codeFence: "markdownCodeFence",
	inlineCode: "markdownInlineCode",
	inlineCodeMarker: "markdownInlineCodeMarker",
	heading: "markdownHeading",
	headingMarker: "markdownHeadingMarker",
	quote: "markdownQuote",
	quoteMarker: "markdownQuoteMarker",
	bullet: "markdownBullet",
	task: "markdownTask",
	rule: "markdownRule",
	bold: "markdownBold",
	boldMarker: "markdownBoldMarker",
	italic: "markdownItalic",
	italicMarker: "markdownItalicMarker",
	strike: "markdownStrike",
	strikeMarker: "markdownStrikeMarker",
	linkText: "markdownLinkText",
	linkUrl: "markdownLinkUrl",
} as const;

/** The node types a span is held between two runs of markers in. */
const SPANS = {
	strong: [LABEL.bold, LABEL.boldMarker],
	emphasis: [LABEL.italic, LABEL.italicMarker],
	delete: [LABEL.strike, LABEL.strikeMarker],
} as const;

/** The marker an ATX heading opens with. */
const HEADING = /^ {0,3}#{1,6}/;

/** The markers a line of a quote opens with, nested quotes and all. */
const QUOTE = /^[ \t]*>[ \t>]*/;

/** The bullet or the number a list item opens with, and the box of a task. */
const BULLET = /^(?:[-*+]|\d{1,9}[.)])/;
const TASK = /^[ \t]+(\[[ xX]\])/;

/** A fence a code or a math block opens or closes on. */
const FENCE = /^[ \t]*(?:`{3,}|~{3,}|\${2,})/;
const FENCE_CLOSING = /^[ \t]*(?:`{3,}|~{3,}|\${2,})[ \t]*$/;

/** A run of the value as a parsed node holds it. */
type Span = [start: number, end: number];

/** A fenced block of code, as it stands in the value. */
export type MarkdownCodeBlock = {
	/** Where the code starts, past the line its fence opens on. */
	start: number;
	code: string;
	language: string | null;
};

/** The highlight of a block of code, once there is one. */
export type MarkdownHighlight = (block: MarkdownCodeBlock) => CodeResult | null;

type Parsed = {
	tree: Root;
	/** A node's span in the value, read off its position in what was parsed. */
	span: (node: Nodes) => Span | null;
};

/** The last few values parsed, each of which is read for its labels and its code. */
const parsed = new Map<string, Parsed>();
const PARSED_LIMIT = 4;

/**
 * The value parsed the way a message is.
 *
 * A message is normalized before it is parsed, which opens a blank line here
 * and there, so the offsets of what was parsed are mapped back onto the value
 * the lines were opened in.
 */
const parse = (value: string): Parsed => {
	const cached = parsed.get(value);
	if (cached) return cached;

	const normalized = MessageMarkdownUtils.normalize(value);

	// Normalizing only ever adds characters, so a character that does not line
	// up with the value is one it added, and maps onto the one after it.
	const offsets = new Int32Array(normalized.length + 1);
	let index = 0;
	for (let at = 0; at < normalized.length; at++) {
		offsets[at] = index;
		if (normalized[at] === value[index]) index += 1;
	}
	offsets[normalized.length] = value.length;

	const result: Parsed = {
		tree: processor.parse(normalized),
		span: (node) => {
			const start = node.position?.start.offset;
			const end = node.position?.end.offset;
			if (start === undefined || end === undefined) return null;
			return [offsets[start], offsets[end]];
		},
	};

	if (parsed.size >= PARSED_LIMIT) {
		const oldest = parsed.keys().next().value;
		if (oldest !== undefined) parsed.delete(oldest);
	}
	parsed.set(value, result);

	return result;
};

/** The lines a span covers, each as the run of it on that line. */
const lines = (value: string, [start, end]: Span): Span[] => {
	const spans: Span[] = [];
	let from = start;

	while (from <= end) {
		const found = value.indexOf("\n", from);
		const to = found === -1 || found > end ? end : found;
		spans.push([from, to]);
		if (to === end) break;
		from = to + 1;
	}

	return spans;
};

/** Every node in the tree, a parent before its children. */
function* walk(node: Nodes): Generator<Nodes> {
	yield node;
	if ("children" in node) {
		for (const child of node.children) yield* walk(child as Nodes);
	}
}

/**
 * A fenced block the code inside of which stands in the value exactly as it
 * was parsed — which is what lets its highlight be laid straight over it. A
 * block indented inside a list or a quote has had its indentation taken off
 * the code, and is left plain.
 */
const codeBlock = (
	value: string,
	node: Nodes,
	[start, end]: Span,
): MarkdownCodeBlock | null => {
	if (node.type !== "code") return null;

	const opened = value.indexOf("\n", start);
	if (opened === -1 || opened >= end) return null;

	const last = value.lastIndexOf("\n", end - 1) + 1;
	const isClosed = last > opened && FENCE_CLOSING.test(value.slice(last, end));
	const code = value.slice(opened + 1, isClosed ? last - 1 : end);

	if (code !== node.value) return null;

	return { start: opened + 1, code, language: node.lang ?? null };
};

/** The colour a token is drawn in, as a terminal takes one. */
const hex = (color: string | undefined) => {
	const match = color?.match(/^#([0-9a-f]{6}|[0-9a-f]{3})(?:[0-9a-f]{1,2})?$/i);
	return match ? `#${match[1]}` : undefined;
};

/**
 * The prefix a list item or a quote carries, which the line after it keeps:
 * the indentation and any quote markers, the bullet or the number, and the
 * checkbox of a task.
 */
const PREFIX =
	/^([ \t]*(?:>[ \t]*)*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?(\[[ xX]\][ \t]+)?/;

/** A fence opened on the line, up to the cursor. */
const FENCE_OPEN = /^ {0,3}`{3,}[^`\n]*$/;

/** The fence closing it, from the cursor to the end of the line. */
const FENCE_CLOSE = /^`{3,}[ \t]*$/;

/** Markers that are closed as they are opened. */
const MARKERS = ["*", "_", "`", "~"];

/** A write the editor makes in place of the one that was typed. */
export type MarkdownWrite = { content: string; offset: number };

/** Spaces a tab indents code by, as many as the app's editor indents it by. */
const TAB_SIZE = 2;

/** A list item: its indentation, its bullet or number, and the space after it. */
const ITEM = /^( *)(?:[-*+]|(\d{1,9})[.)])(?:[ \t]+|$)/;

/** Characters a bold or an italic is marked with. */
const EMPHASIS = ["*", "_"];

/** A run of the value taken out and the text put in its place. */
type Splice = { at: number; remove: number; insert: string };

/** A line of the value, and where it starts in it. */
type Line = { start: number; text: string };

const splitLines = (value: string): Line[] => {
	const result: Line[] = [];
	let start = 0;
	for (const text of value.split("\n")) {
		result.push({ start, text });
		start += text.length + 1;
	}
	return result;
};

/** The index of the line an offset is on. */
const lineAt = (lines: Line[], offset: number) => {
	let index = 0;
	while (index + 1 < lines.length && lines[index + 1].start <= offset)
		index += 1;
	return index;
};

const indentOf = (text: string) => text.length - text.trimStart().length;

const spacesOf = (text: string) => /^ */.exec(text)?.[0].length ?? 0;

/**
 * Makes splices that do not overlap, carrying each point through them: one
 * inside a run taken out ends up where the run was, and one where text is put
 * in is pushed along past it.
 */
const splice = (
	value: string,
	splices: Splice[],
	points: TextareaSelection,
): TextareaEdit => {
	const sorted = [...splices].sort((a, b) => a.at - b.at);

	let result = "";
	let from = 0;
	for (const { at, remove, insert } of sorted) {
		result += value.slice(from, at) + insert;
		from = at + remove;
	}
	result += value.slice(from);

	const carry = (point: number) => {
		let shift = 0;
		for (const { at, remove, insert } of sorted) {
			if (point < at) break;
			if (point < at + remove) return at + shift;
			shift += insert.length - remove;
		}
		return point + shift;
	};

	return { value: result, selection: [carry(points[0]), carry(points[1])] };
};

/** Whether an offset is in the code of a block of code, rather than on a fence of it. */
const isInCode = (value: string, offset: number) => {
	const { tree, span } = parse(value);

	for (const node of walk(tree)) {
		if (node.type !== "code") continue;

		const spanned = span(node);
		if (!spanned) continue;

		const [start, end] = spanned;
		if (offset < start || offset > end) continue;

		const opened = value.indexOf("\n", start);
		const opening = value.slice(start, opened === -1 ? end : opened);
		if (!FENCE.test(opening)) return true;
		if (opened === -1 || opened >= end || offset <= opened) return false;

		const last = value.lastIndexOf("\n", end - 1) + 1;
		const isClosed =
			last > opened && FENCE_CLOSING.test(value.slice(last, end));
		return !isClosed || offset < last;
	}

	return false;
};

/**
 * The item a list item is nested under, which is the nearest one above it
 * less indented, past whatever is nested as deep as it or deeper.
 */
const parentOf = (lines: Line[], index: number, indent: number) => {
	for (let at = index - 1; at >= 0; at--) {
		const { text } = lines[at];
		if (!text.trim() || indentOf(text) >= indent) continue;
		return ITEM.exec(text);
	}
	return null;
};

/**
 * The item above a list item in the same list, past whatever is nested under
 * it.
 */
const siblingOf = (lines: Line[], index: number, indent: number) => {
	for (let at = index - 1; at >= 0; at--) {
		const { text } = lines[at];
		if (!text.trim() || indentOf(text) > indent) continue;

		const match = ITEM.exec(text);
		return match && match[1].length === indent ? match : null;
	}
	return null;
};

export const MarkdownUtils = {
	/**
	 * Rules that paint the markdown, for the text area's `labels`.
	 *
	 * @param highlight The highlight of a block of code, laid over it once
	 * there is one.
	 */
	labels: ({
		highlight,
	}: {
		highlight?: MarkdownHighlight;
	} = {}): TextareaLabels => [
		{ ranges: (value) => MarkdownUtils.ranges({ value, highlight }) },
	],

	/** The runs of the value each node it parses into paints, in order. */
	ranges: ({
		value,
		highlight,
	}: {
		value: string;
		highlight?: MarkdownHighlight;
	}): TextareaRange[] => {
		const { tree, span } = parse(value);

		const labels: string[] = new Array(value.length).fill("");
		const styles: (TextareaStyle | undefined)[] = new Array(value.length);

		const mark = ([start, end]: Span, label: string) => {
			for (let index = start; index < end; index++) {
				labels[index] = labels[index] ? `${labels[index]}+${label}` : label;
			}
		};

		const style = ([start, end]: Span, drawn: TextareaStyle) => {
			for (let index = start; index < end; index++) styles[index] = drawn;
		};

		/** A block held between fence lines, which are painted apart from it. */
		const fenced = ([start, end]: Span, label: string) => {
			mark([start, end], label);

			const spans = lines(value, [start, end]);
			const [first] = spans;
			const last = spans[spans.length - 1];

			if (FENCE.test(value.slice(...first))) mark(first, LABEL.codeFence);
			if (spans.length > 1 && FENCE_CLOSING.test(value.slice(...last)))
				mark(last, LABEL.codeFence);
		};

		for (const node of walk(tree)) {
			const at = span(node);
			if (!at) continue;
			const [start, end] = at;

			const children = "children" in node ? (node.children as Nodes[]) : [];
			const inner =
				children.length > 0
					? ([
							span(children[0])?.[0] ?? start,
							span(children[children.length - 1])?.[1] ?? end,
						] as Span)
					: null;

			switch (node.type) {
				case "strong":
				case "emphasis":
				case "delete": {
					const [label, marker] = SPANS[node.type];
					mark(at, label);
					if (!inner) break;
					mark([start, inner[0]], marker);
					mark([inner[1], end], marker);
					break;
				}

				case "inlineCode":
				case "inlineMath": {
					mark(at, LABEL.inlineCode);
					const opening = value.slice(start, end).match(/^[`$]+/)?.[0].length;
					const closing = value.slice(start, end).match(/[`$]+$/)?.[0].length;
					if (opening) mark([start, start + opening], LABEL.inlineCodeMarker);
					if (closing && end - closing > start + (opening ?? 0))
						mark([end - closing, end], LABEL.inlineCodeMarker);
					break;
				}

				case "code": {
					fenced(at, LABEL.code);

					const block = codeBlock(value, node, at);
					const result = block && highlight?.(block);
					if (!block || !result) break;

					// The block is drawn on the theme's own background, the way the
					// message draws it, and each token in its own colour over it.
					const bgColor = hex(result.bg);
					if (bgColor) style(at, { bgColor });

					// The highlight may be of the code as it stood a keystroke ago, so
					// each of its lines is laid over the line in the same place by
					// where its tokens fall along it, and cut off at that line's end —
					// the colours stay put until the next highlight takes over, rather
					// than going plain in the meantime.
					let lineStart = block.start;
					for (const [index, text] of block.code.split("\n").entries()) {
						const lineEnd = lineStart + text.length;
						let from = lineStart;

						for (const token of result.tokens[index] ?? []) {
							if (from >= lineEnd) break;
							const to = Math.min(from + token.content.length, lineEnd);
							const color = hex(
								token.color ??
									(token.htmlStyle as { color?: string } | undefined)?.color,
							);
							if (color) style([from, to], { color, bgColor });
							from = to;
						}

						lineStart = lineEnd + 1;
					}
					break;
				}

				case "math":
					fenced(at, LABEL.code);
					break;

				case "heading": {
					mark(at, LABEL.heading);

					const atx = value.slice(start, end).match(HEADING);
					if (atx) {
						mark([start, start + atx[0].length], LABEL.headingMarker);
						break;
					}

					// Underlined, on the line after the text.
					const underline = value.indexOf("\n", inner?.[1] ?? start);
					if (underline !== -1 && underline < end)
						mark([underline + 1, end], LABEL.headingMarker);
					break;
				}

				case "blockquote": {
					mark(at, LABEL.quote);
					for (const [from, to] of lines(value, at)) {
						const marker = value.slice(from, to).match(QUOTE);
						if (marker)
							mark([from, from + marker[0].length], LABEL.quoteMarker);
					}
					break;
				}

				case "listItem": {
					const bullet = value.slice(start, end).match(BULLET);
					if (!bullet) break;

					const after = start + bullet[0].length;
					mark([start, after], LABEL.bullet);

					if (node.checked === null || node.checked === undefined) break;
					const task = value.slice(after, end).match(TASK);
					if (task) {
						const box = after + task[0].length - task[1].length;
						mark([box, box + task[1].length], LABEL.task);
					}
					break;
				}

				case "thematicBreak":
					mark(at, LABEL.rule);
					break;

				case "link":
				case "linkReference":
				case "image":
				case "imageReference": {
					// A bare address is all text, where one written out has its text
					// in brackets and its target after them.
					const opening = value[start] === "!" ? 2 : 1;
					if (value[start + opening - 1] !== "[") {
						mark(at, LABEL.linkText);
						break;
					}

					const closed = inner
						? value.indexOf("]", inner[1])
						: value.indexOf("]", start + opening);
					const text = closed === -1 || closed >= end ? end : closed + 1;
					mark([start, text], LABEL.linkText);
					mark([text, end], LABEL.linkUrl);
					break;
				}
			}
		}

		const ranges: TextareaRange[] = [];
		for (let index = 0; index < value.length; index++) {
			const label = labels[index];
			const drawn = styles[index];
			if (!label && !drawn) continue;

			const previous = ranges[ranges.length - 1];
			if (
				previous &&
				previous.end === index &&
				previous.label === (label || "text") &&
				previous.style === drawn
			) {
				previous.end += 1;
				continue;
			}

			ranges.push({
				start: index,
				end: index + 1,
				label: label || "text",
				style: drawn,
			});
		}

		return ranges;
	},

	/**
	 * Whether the character at an offset is code — in a block of code, or
	 * between the backticks of inline code — where nothing typed means more
	 * than the text it is.
	 */
	isInCode: (value: string, offset: number) => {
		if (isInCode(value, offset)) return true;

		const { tree, span } = parse(value);
		for (const node of walk(tree)) {
			if (node.type !== "inlineCode") continue;

			const spanned = span(node);
			if (!spanned) continue;

			const [start, end] = spanned;
			const text = value.slice(start, end);
			const opening = text.match(/^`+/)?.[0].length ?? 0;
			const closing = text.match(/`+$/)?.[0].length ?? 0;
			if (offset >= start + opening && offset < end - closing) return true;
		}

		return false;
	},

	/** Every fenced block of code in the value whose code can be highlighted where it stands. */
	codeBlocks: (value: string): MarkdownCodeBlock[] => {
		const { tree, span } = parse(value);
		const blocks: MarkdownCodeBlock[] = [];

		for (const node of walk(tree)) {
			if (node.type !== "code") continue;
			const at = span(node);
			const block = at && codeBlock(value, node, at);
			if (block) blocks.push(block);
		}

		return blocks;
	},

	/**
	 * How each of those labels is drawn, for the text area's `styles`.
	 *
	 * A marker is set apart by its colour rather than by `dim`, which the
	 * terminal turns off with the same code it turns bold off with — dimming the
	 * markers of a bold span would take the bold off the span itself.
	 */
	styles: (colorScheme: ColorScheme): TextareaStyles => ({
		[LABEL.codeFence]: { color: colorScheme.textSubtle },
		[LABEL.code]: {
			color: colorScheme.textSubtle,
			bgColor: colorScheme.interior,
		},
		[LABEL.inlineCodeMarker]: {
			color: colorScheme.textSubtle,
			bgColor: colorScheme.interior,
		},
		[LABEL.inlineCode]: {
			color: colorScheme.text,
			bgColor: colorScheme.interior,
		},

		[LABEL.headingMarker]: { color: colorScheme.primary, bold: true },
		[LABEL.heading]: { bold: true },
		[LABEL.quoteMarker]: { color: colorScheme.primary },
		[LABEL.quote]: { color: colorScheme.textSubtle, italic: true },
		[LABEL.bullet]: { color: colorScheme.primary, bold: true },
		[LABEL.task]: { color: colorScheme.primary },
		[LABEL.rule]: { color: colorScheme.textSubtle },

		[LABEL.boldMarker]: { color: colorScheme.textSubtle, bold: true },
		[LABEL.bold]: { bold: true },
		[LABEL.italicMarker]: { color: colorScheme.textSubtle, italic: true },
		[LABEL.italic]: { italic: true },
		[LABEL.strikeMarker]: {
			color: colorScheme.textSubtle,
			strikethrough: true,
		},
		[LABEL.strike]: { strikethrough: true },

		[LABEL.linkText]: { color: colorScheme.primary, underline: true },
		[LABEL.linkUrl]: { color: colorScheme.textSubtle },
	}),

	/**
	 * The write a typed marker makes in place of writing itself, so that a span
	 * is closed as it is opened. Null when the marker is written as it was
	 * typed.
	 *
	 * A marker typed against one already standing steps over it instead of
	 * doubling it — unless it is standing at the opening, where a second one
	 * turns an italic into a bold rather than closing it.
	 *
	 * @param value The content as it stood before the marker was typed.
	 * @param offset Where the cursor was when it was.
	 */
	marked: ({
		value,
		offset,
		marker,
	}: {
		value: string;
		offset: number;
		marker: string;
	}): MarkdownWrite | null => {
		if (!MARKERS.includes(marker)) return null;

		let start = offset;
		while (start > 0 && value[start - 1] === marker) start -= 1;

		let end = offset;
		while (end < value.length && value[end] === marker) end += 1;

		const before = value[start - 1];
		const after = value[end];

		// A marker run that nothing precedes is the opening of a span rather than
		// the closing of one, however many markers have been typed into it.
		const isOpening = before === undefined || /[\s([{<"']/.test(before);

		// The span is being closed by hand, on the marker already closing it.
		if (end > offset && !isOpening)
			return { content: value, offset: offset + 1 };

		// Marking a word up from its left, where the closing marker belongs at the
		// far end of it rather than against the cursor — so the one that was typed
		// is written as it was.
		if (after !== undefined && /[\p{L}\p{N}]/u.test(after)) return null;

		return {
			content: `${value.slice(0, offset)}${marker}${marker}${value.slice(offset)}`,
			offset: offset + 1,
		};
	},

	/**
	 * The write a newline makes in place of writing itself, so that the block
	 * the cursor is in carries on: a list keeps its bullet or its next number, a
	 * quote keeps its marker, and a fence opened and closed on the one line is
	 * broken open with the cursor between the two of them.
	 *
	 * An item or a quote that is still empty is ended instead, its marker taken
	 * back off. Null when the newline is written as it was typed.
	 */
	broken: ({
		value,
		offset,
	}: {
		value: string;
		offset: number;
	}): MarkdownWrite | null => {
		const start = value.lastIndexOf("\n", offset - 1) + 1;
		const found = value.indexOf("\n", offset);
		const end = found === -1 ? value.length : found;

		if (
			FENCE_OPEN.test(value.slice(start, offset)) &&
			FENCE_CLOSE.test(value.slice(offset, end))
		)
			return {
				content: `${value.slice(0, offset)}\n\n${value.slice(offset)}`,
				offset: offset + 1,
			};

		const line = value.slice(start, end);
		const match = line.match(PREFIX);
		if (!match) return null;

		const [prefix, quote, marker = "", task = ""] = match;
		if (!quote.includes(">") && !marker) return null;

		// Nothing was written into the item or the quote, so the block ends here
		// rather than opening another one: the marker is taken back off and the
		// cursor left on the line it stood on.
		if (!line.slice(prefix.length).trim())
			return {
				content: `${value.slice(0, start)}${value.slice(end)}`,
				offset: start,
			};

		const next = `${quote}${marker.replace(/^\d{1,9}/, (digits) => String(Number(digits) + 1))}${task ? "[ ] " : ""}`;

		return {
			content: `${value.slice(0, offset)}\n${next}${value.slice(offset)}`,
			offset: offset + 1 + next.length,
		};
	},

	/**
	 * The edit Tab makes, or Shift and Tab, the way the app's editor makes it:
	 * code is indented by two spaces — at the cursor, or before every line
	 * selected — and a list item is nested under the one above it, or lifted
	 * out from under the one it is nested in, taking its own nested items
	 * along. Null where the key makes no edit at all.
	 *
	 * @param direction 1 to indent, -1 to unindent.
	 */
	indented: ({
		value,
		selection,
		direction,
	}: {
		value: string;
		selection: TextareaSelection;
		direction: 1 | -1;
	}): TextareaEdit | null => {
		const start = Math.min(...selection);
		const end = Math.max(...selection);
		const lines = splitLines(value);

		const first = lineAt(lines, start);
		// A selection that runs up to the start of a line leaves that line be.
		let last = lineAt(lines, end);
		if (last > first && lines[last].start === end) last -= 1;

		const edit = (splices: Splice[]) =>
			splices.length ? splice(value, splices, selection) : null;

		if (isInCode(value, start) && isInCode(value, end)) {
			const indent = " ".repeat(TAB_SIZE);

			if (direction === 1 && start === end)
				return edit([{ at: start, remove: 0, insert: indent }]);

			const splices: Splice[] = [];
			for (let index = first; index <= last; index++) {
				const { start: at, text } = lines[index];
				if (direction === 1) splices.push({ at, remove: 0, insert: indent });
				else {
					const remove = Math.min(TAB_SIZE, spacesOf(text));
					if (remove) splices.push({ at, remove, insert: "" });
				}
			}
			return edit(splices);
		}

		const item = ITEM.exec(lines[first].text);
		if (!item) return null;

		const indent = item[1].length;

		// The item takes whatever is nested under it along.
		while (
			last + 1 < lines.length &&
			lines[last + 1].text.trim() &&
			indentOf(lines[last + 1].text) > indent
		)
			last += 1;

		const marker = item[0].length - indent;

		// A list item at the top of its list is lifted out of it altogether, its
		// marker taken off.
		if (direction === -1 && indent === 0)
			return edit([{ at: lines[first].start, remove: marker, insert: "" }]);

		let step: number;
		let number = 1;

		if (direction === 1) {
			// The first item of a list has nothing above it to be nested under.
			const sibling = siblingOf(lines, first, indent);
			if (!sibling) return null;

			step = sibling[0].length - indent;

			const above = siblingOf(lines, first, indent + step);
			if (above?.[2]) number = Number(above[2]) + 1;
		} else {
			const parent = parentOf(lines, first, indent);
			step = indent - (parent?.[1].length ?? 0);

			if (parent?.[2]) number = Number(parent[2]) + 1;
		}

		const splices: Splice[] = [];
		for (let index = first; index <= last; index++) {
			const { start: at, text } = lines[index];
			if (!text.trim()) continue;

			if (direction === 1)
				splices.push({ at, remove: 0, insert: " ".repeat(step) });
			else {
				const remove = Math.min(step, spacesOf(text));
				if (remove) splices.push({ at, remove, insert: "" });
			}
		}

		// A numbered item carries on the count of the list it is moved into, or
		// starts one of its own.
		if (item[2] && Number(item[2]) !== number)
			splices.push({
				at: lines[first].start + indent,
				remove: item[2].length,
				insert: String(number),
			});

		return edit(splices);
	},

	/**
	 * Bold or italic toggled over the selection, the way the app's editor
	 * toggles a mark: a selection is wrapped in its markers, or unwrapped where
	 * it is already held between them — standing either side of it or selected
	 * along with it. A cursor between markers with nothing in them takes them
	 * back off; one at the end of a span steps out past them; and anywhere else
	 * opens a span around itself.
	 *
	 * @param size 2 for bold, 1 for italic.
	 */
	toggled: ({
		value,
		selection,
		size,
	}: {
		value: string;
		selection: TextareaSelection;
		size: 1 | 2;
	}): TextareaEdit => {
		const isBackward = selection[0] > selection[1];
		const result = (content: string, from: number, to = from) => ({
			value: content,
			selection: (isBackward ? [to, from] : [from, to]) as TextareaSelection,
		});

		let start = Math.min(...selection);
		let end = Math.max(...selection);

		// A span does not open or close against a space, so any selected at
		// either end of it is left outside.
		const selected = value.slice(start, end);
		if (selected.trim()) {
			start += selected.length - selected.trimStart().length;
			end -= selected.length - selected.trimEnd().length;
		}

		// A marker already standing at the selection decides which of the two
		// the span is marked with.
		const char =
			[value[start - 1], value[end], value[start], value[end - 1]].find(
				(found) => found !== undefined && EMPHASIS.includes(found),
			) ?? "*";

		const run = (from: number, step: 1 | -1, limit: number) => {
			let count = 0;
			let at = step === 1 ? from : from - 1;
			while ((step === 1 ? at < limit : at >= limit) && value[at] === char) {
				count += 1;
				at += step;
			}
			return count;
		};

		const outerLeft = run(start, -1, 0);
		const innerLeft = run(start, 1, end);
		const innerRight = run(end, -1, start + innerLeft);
		const outerRight = run(end, 1, value.length);

		const left = outerLeft + innerLeft;
		const right = innerRight + outerRight;

		// Three markers are a bold and an italic at once.
		const holds = (count: number) =>
			size === 2 ? count >= 2 : count % 2 === 1;

		const contentStart = start + innerLeft;
		const contentEnd = end - innerRight;

		if (holds(left) && holds(right)) {
			const before = `${value.slice(0, start - outerLeft)}${char.repeat(left - size)}`;
			const inner = value.slice(contentStart, contentEnd);
			return result(
				`${before}${inner}${char.repeat(right - size)}${value.slice(end + outerRight)}`,
				before.length,
				before.length + inner.length,
			);
		}

		const markers = char.repeat(size);

		if (start === end) {
			// At the end of a span, where the cursor steps out of it.
			if (holds(outerRight) && start > 0 && !/\s/.test(value[start - 1]))
				return result(value, start + size);

			return result(
				`${value.slice(0, start)}${markers}${markers}${value.slice(start)}`,
				start + size,
			);
		}

		return result(
			`${value.slice(0, start)}${markers}${value.slice(start, end)}${markers}${value.slice(end)}`,
			start + size,
			end + size,
		);
	},
} as const;
