import stringWidth from "string-width";
import type {
	TextareaCursor,
	TextareaLabels,
	TextareaRow,
	TextareaSelection,
	TextareaStyle,
	TextareaStyles,
} from "#tui/features/textarea/types/textarea.ts";

/** Columns a tab is drawn across. */
export const TAB_WIDTH = 4;

/** The label of text that no rule has claimed. */
export const TEXT_LABEL = "text";

/** What a character is painted under: a label, and a style of its own over it. */
export type TextareaPaint = { label: string; style?: TextareaStyle };

/** The paint of text that no rule has claimed. */
export const TEXT_PAINT: TextareaPaint = { label: TEXT_LABEL };

const SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The kinds of run a selection taken a word at a time takes whole. */
type TextareaWord = "word" | "symbol" | "space";

/**
 * Which run a character belongs to. A newline belongs to none of them, so a run
 * never carries across a line.
 */
const wordKind = (char: string | undefined): TextareaWord | null => {
	if (char === undefined || char === "\n") return null;
	if (/\s/.test(char)) return "space";
	return /[\p{L}\p{N}_]/u.test(char) ? "word" : "symbol";
};

/** Styles resolved by label, per set of styles, which outlive a render. */
const RESOLVED = new WeakMap<TextareaStyles, Map<string, TextareaStyle>>();
const NO_STYLES: TextareaStyles = {};

/**
 * Geometry of the text area: how the value is wrapped into rows, scrolled
 * under the viewport, and stepped across by the cursor.
 */
export const TextareaUtils = {
	/**
	 * The style a label is drawn in, which for labels joined by `+` is all of
	 * theirs, the later over the earlier.
	 */
	style: (styles: TextareaStyles | undefined, label: string) => {
		const key = styles ?? NO_STYLES;
		let resolved = RESOLVED.get(key);
		if (!resolved) {
			resolved = new Map();
			RESOLVED.set(key, resolved);
		}

		let style = resolved.get(label);
		if (!style) {
			style = Object.assign(
				{},
				...label
					.split("+")
					.map((part) => (part === TEXT_LABEL ? {} : key[part])),
			) as TextareaStyle;
			resolved.set(label, style);
		}
		return style;
	},

	/** The text split into graphemes, each with the offset it starts at. */
	graphemes: (text: string) =>
		Array.from(SEGMENTER.segment(text), ({ segment, index }) => ({
			segment,
			index,
		})),

	/** Columns a single grapheme takes up once the terminal draws it. */
	width: (grapheme: string) => {
		if (grapheme.length === 0) return 0;
		if (grapheme === "\t") return TAB_WIDTH;

		const code = grapheme.charCodeAt(0);
		if (grapheme.length === 1) {
			if (code >= 0x20 && code < 0x7f) return 1;
			if (code < 0x20) return 0;
		}

		return stringWidth(grapheme);
	},

	/** Columns a run of text takes up. */
	textWidth: (text: string) => {
		let width = 0;
		for (const { segment } of SEGMENTER.segment(text)) {
			width += TextareaUtils.width(segment);
		}
		return width;
	},

	/** Where the grapheme before the offset starts. */
	previous: (value: string, offset: number) => {
		if (offset <= 0) return 0;

		let start = 0;
		for (const { index } of SEGMENTER.segment(value)) {
			if (index >= offset) break;
			start = index;
		}
		return start;
	},

	/** Where the grapheme after the offset ends. */
	next: (value: string, offset: number) => {
		if (offset >= value.length) return value.length;

		for (const { segment, index } of SEGMENTER.segment(value)) {
			if (index + segment.length > offset) return index + segment.length;
		}
		return value.length;
	},

	/**
	 * Lays the value out into the rows it is drawn in, in order.
	 *
	 * @param width Columns available to the text, which is where lines wrap.
	 * @param cursor Where the cursor is drawn, or null while it is not.
	 */
	rows: ({
		value,
		width,
		cursor,
	}: {
		value: string;
		width: number;
		cursor: TextareaCursor | null;
	}): TextareaRow[] => {
		const rows: TextareaRow[] = [];

		for (const [line, text] of value.split("\n").entries()) {
			if (width <= 0 || text.length === 0) {
				rows.push({ line, column: 0, text });
				continue;
			}

			let chunk = "";
			let chunkWidth = 0;
			let column = 0;
			let lastWidth = 0;

			const flush = () => {
				rows.push({ line, column, text: chunk });
				lastWidth = chunkWidth;
				column += chunk.length;
				chunk = "";
				chunkWidth = 0;
			};

			for (const { segment } of SEGMENTER.segment(text)) {
				const size = TextareaUtils.width(segment);
				if (chunkWidth + size > width && chunk.length > 0) flush();
				chunk += segment;
				chunkWidth += size;
			}
			flush();

			// A line that fills its last row exactly leaves the cursor nowhere to
			// sit, so an empty row is opened for it.
			if (
				cursor &&
				line === cursor[0] &&
				cursor[1] === text.length &&
				lastWidth === width
			) {
				rows.push({ line, column: text.length, text: "" });
			}
		}

		return rows;
	},

	/** Which row the cursor is on, or -1 when it is on none of them. */
	row: ({
		rows,
		cursor: [line, column],
	}: {
		rows: readonly TextareaRow[];
		cursor: TextareaCursor;
	}) => {
		let index = -1;

		for (const [current, row] of rows.entries()) {
			if (row.line !== line) {
				// Past the line already, so the last match was the one.
				if (index >= 0) break;
				continue;
			}
			if (row.column > column) break;
			index = current;
		}

		return index;
	},

	/**
	 * The row the viewport starts at. It only moves far enough to bring the
	 * cursor back into view.
	 *
	 * @param height Rows the viewport shows at once.
	 */
	scroll: ({
		offset,
		index,
		count,
		height,
	}: {
		offset: number;
		index: number;
		count: number;
		height: number;
	}) => {
		const viewport = Math.max(1, height);

		let next = offset;
		if (index >= 0 && index < offset) next = index;
		else if (index >= offset + viewport) next = index - viewport + 1;

		return Math.min(Math.max(0, count - viewport), Math.max(0, next));
	},

	/**
	 * The position a point inside the text area points at, with the point given
	 * relative to the text area's top left corner.
	 *
	 * @param offset The row the viewport starts at, from {@link TextareaUtils.scroll}.
	 */
	position: ({
		value,
		rows,
		point,
		offset,
	}: {
		value: string;
		rows: readonly TextareaRow[];
		point: { x: number; y: number };
		offset: number;
	}): TextareaCursor => {
		const row = rows[Math.min(Math.max(offset + point.y, 0), rows.length - 1)];
		if (!row) return TextareaUtils.cursor(value, value.length);

		let column = 0;
		let consumed = 0;

		for (const { segment } of SEGMENTER.segment(row.text)) {
			const size = TextareaUtils.width(segment);
			if (point.x < consumed + size) break;
			consumed += size;
			column += segment.length;
		}

		return [row.line, row.column + column];
	},

	/** The cursor as an offset into the value, clamped to it. */
	offset: (value: string, [line, column]: TextareaCursor) => {
		const lines = value.split("\n");
		const index = Math.max(0, Math.min(line, lines.length - 1));

		let offset = 0;
		for (let current = 0; current < index; current++) {
			offset += (lines[current] ?? "").length + 1;
		}

		return offset + Math.max(0, Math.min(column, (lines[index] ?? "").length));
	},

	/** The inverse of {@link TextareaUtils.offset}. */
	cursor: (value: string, offset: number): TextareaCursor => {
		let line = 0;
		let start = 0;

		for (let index = 0; index < offset; index++) {
			if (value[index] !== "\n") continue;
			line += 1;
			start = index + 1;
		}

		return [line, offset - start];
	},

	/**
	 * The offset a step onto the row above or below lands on, holding the column
	 * the cursor was drawn at. Off either end, the nearest edge of the value.
	 */
	vertical: ({
		value,
		rows,
		cursor,
		direction,
	}: {
		value: string;
		rows: readonly TextareaRow[];
		cursor: TextareaCursor;
		direction: 1 | -1;
	}) => {
		const index = TextareaUtils.row({ rows, cursor });
		if (index < 0) return TextareaUtils.offset(value, cursor);

		const target = index + direction;
		if (target < 0) return 0;
		if (target >= rows.length) return value.length;

		const row = rows[index];
		const x = TextareaUtils.textWidth(
			row.text.slice(0, Math.max(0, cursor[1] - row.column)),
		);

		return TextareaUtils.offset(
			value,
			// The row is pointed at directly, so the viewport plays no part in it.
			TextareaUtils.position({
				value,
				rows,
				point: { x, y: target },
				offset: 0,
			}),
		);
	},

	/**
	 * What every character is painted under. The rules are read in order, and
	 * the first one to claim a character keeps it.
	 */
	paint: (value: string, labels: TextareaLabels) => {
		const painted: TextareaPaint[] = new Array(value.length).fill(TEXT_PAINT);

		const claim = (start: number, end: number, paint: TextareaPaint) => {
			for (let index = Math.max(0, start); index < end; index++) {
				if (index >= value.length) break;
				if (painted[index] === TEXT_PAINT) painted[index] = paint;
			}
		};

		for (const rule of labels) {
			if ("ranges" in rule) {
				for (const range of rule.ranges(value)) {
					claim(range.start, range.end, range);
				}
				continue;
			}

			for (const match of value.matchAll(rule.pattern)) {
				const start = match.index ?? 0;
				const end = start + match[0].length;
				if (end === start) continue;

				const label =
					typeof rule.label === "string" ? rule.label : rule.label(match);
				if (label) claim(start, end, { label });
			}
		}

		return painted;
	},

	/** The selection in order, as offsets into the value. */
	range: ([anchor, focus]: TextareaSelection): [start: number, end: number] =>
		anchor <= focus ? [anchor, focus] : [focus, anchor],

	/** The selected text, empty while nothing is selected. */
	selected: (value: string, selection: TextareaSelection | null) => {
		if (!selection) return "";
		const [start, end] = TextareaUtils.range(selection);
		return value.slice(start, end);
	},

	/**
	 * The run of like characters the offset sits in, which a double click takes
	 * whole: a word, a stretch of punctuation, or the space between two of them.
	 *
	 * The run before the offset is taken over the space after it, so a click
	 * against the end of a word still takes the word.
	 */
	word: (value: string, offset: number): [start: number, end: number] => {
		const index = Math.max(0, Math.min(offset, value.length));

		const after = wordKind(value[index]);
		const kind =
			after && after !== "space"
				? after
				: (wordKind(value[index - 1]) ?? after);

		// Against a line's own edge, where there is no run to either side.
		if (!kind) return [index, index];

		let start = index;
		while (start > 0 && wordKind(value[start - 1]) === kind) start -= 1;

		let end = index;
		while (end < value.length && wordKind(value[end]) === kind) end += 1;

		return [start, end];
	},

	/**
	 * A selection dragged a word at a time, from the word it was started on out
	 * to the word it has reached. Kept pointing the way it was dragged, so it can
	 * go on growing either way.
	 */
	words: (
		value: string,
		[start, end]: [start: number, end: number],
		focused: number,
	): TextareaSelection => {
		if (focused < start) return [end, TextareaUtils.word(value, focused)[0]];
		if (focused > end) return [start, TextareaUtils.word(value, focused)[1]];

		// Still on the word it was started on, which stands as it was taken.
		return [start, end];
	},

	/** Start of the word before the offset, skipping any whitespace in between. */
	wordStart: (value: string, offset: number) => {
		let index = offset - 1;
		while (index >= 0 && /\s/.test(value[index])) index -= 1;
		while (index >= 0 && !/\s/.test(value[index])) index -= 1;
		return index + 1;
	},

	/** End of the word after the offset, plus any whitespace trailing it. */
	wordEnd: (value: string, offset: number) => {
		let index = offset;
		while (index < value.length && !/\s/.test(value[index])) index += 1;
		while (index < value.length && /\s/.test(value[index])) index += 1;
		return index;
	},
} as const;
