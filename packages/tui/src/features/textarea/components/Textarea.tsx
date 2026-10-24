import {
	type DOMElement,
	type Key,
	Text,
	useBoxMetrics,
	useInput,
	usePaste,
	useWindowSize,
} from "ink";
import { type ReactNode, useContext, useMemo, useRef, useState } from "react";
import { ThemeContext } from "#client/core/components/ThemeContext.tsx";
import { useMergedRef } from "#client/core/hooks/useMergedRef.ts";
import Box from "#tui/core/components/Box.tsx";
import { useMouse } from "#tui/core/hooks/useMouse.ts";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { MouseUtils } from "#tui/core/utils/MouseUtils.ts";
import {
	SELECTION_STYLE,
	useSelection,
} from "#tui/features/selection/hooks/useSelection.ts";
import { useCursorBlink } from "#tui/features/textarea/hooks/useCursorBlink.ts";
import { useUndo } from "#tui/features/textarea/hooks/useUndo.ts";
import type {
	TextareaCursor,
	TextareaEdit,
	TextareaLabels,
	TextareaRow,
	TextareaSelection,
	TextareaStyle,
	TextareaStyles,
} from "#tui/features/textarea/types/textarea.ts";
import {
	TAB_WIDTH,
	TEXT_LABEL,
	TEXT_PAINT,
	type TextareaPaint,
	TextareaUtils,
} from "#tui/features/textarea/utils/TextareaUtils.ts";

/** Rows a single turn of the wheel scrolls. */
const WHEEL_STEP = 1;

/** Selected text is drawn the way the terminal draws its own selection. */
const SELECTION_PAINT: TextareaPaint = {
	label: TEXT_LABEL,
	style: SELECTION_STYLE,
};

/** Text drawn with its colours swapped, which is how the cursor is drawn. */
const inverse = (text: string) => `\x1b[7m${text}\x1b[27m`;

const textProps = (style: TextareaStyle | undefined) =>
	style && {
		color: style.color,
		backgroundColor: style.bgColor,
		bold: style.bold,
		italic: style.italic,
		underline: style.underline,
		strikethrough: style.strikethrough,
	};

export type TextareaProps = {
	value: string;
	onChange: (value: string) => void;
	/** Whether keys go to the text area, and the cursor is drawn. */
	focus: boolean;
	/** Drawn dimmed while the value is empty. */
	placeholder?: string;
	/** Rules that paint the value, styled by `styles`. */
	labels?: TextareaLabels;
	/** Styles by label, with `text` for the text no label has claimed. */
	styles?: TextareaStyles;
	/** The cursor, held here when it is left uncontrolled. */
	cursor?: TextareaCursor;
	onCursorChange?: (cursor: TextareaCursor) => void;
	/** The selection, held here when it is left uncontrolled. */
	selection?: TextareaSelection | null;
	onSelectionChange?: (selection: TextareaSelection | null) => void;
	/**
	 * Where a cursor landing on an offset should go instead, for a value with
	 * runs in it that are only ever handled whole.
	 */
	snap?: (offset: number, from?: number) => number;
	/** Stretches a selection, or a range being deleted, over any such run it reaches into. */
	expand?: (selection: TextareaSelection) => TextareaSelection;
	/** Takes a plain Enter over, in place of the newline it writes. Shift and Enter always writes one. */
	onEnter?: () => void;
	/** Ctrl, Alt or Meta and Enter. */
	onSubmit?: (value: string) => void;
	/** Takes a bracketed paste over, in place of inserting it at the cursor. */
	onPaste?: (text: string) => void;
	/**
	 * Sees every key before the text area does, and takes it from it by
	 * returning true — or by returning the edit it makes in its place, which is
	 * undone and redone like any other.
	 */
	onKey?: (
		input: string,
		key: Key,
	) => boolean | TextareaEdit | null | undefined;
	/**
	 * Sees the offset a click landed on — inside a run that goes whole, too —
	 * before the text area moves the cursor there, and takes the click from it by
	 * returning true.
	 */
	onClick?: (offset: number) => boolean | undefined;
};

/**
 * A multiline text field: wrapped to its width, scrolled under half the
 * terminal's height, and painted by pattern. It is selected out of as any
 * other text is (see {@link useSelection}), with the cursor following the
 * selection, and cut out of with Ctrl+X and pasted into.
 */
export default function Textarea({
	value,
	onChange,
	focus,
	placeholder,
	labels,
	styles,
	cursor: controlledCursor,
	onCursorChange,
	selection: controlledSelection,
	onSelectionChange,
	snap,
	expand,
	onEnter,
	onSubmit,
	onPaste,
	onKey,
	onClick,
}: TextareaProps) {
	const { colorScheme } = useContext(ThemeContext);
	const { rows: terminalRows } = useWindowSize();

	const [uncontrolledCursor, setUncontrolledCursor] = useState<TextareaCursor>([
		0, 0,
	]);

	const cursor = controlledCursor ?? uncontrolledCursor;
	const offset = TextareaUtils.offset(value, cursor);

	const blink = useCursorBlink(focus);
	const history = useUndo();

	/** Moves the cursor to an offset into the value, or into the one given. */
	const moveTo = (to: number, against = value) => {
		const next = TextareaUtils.cursor(against, to);
		setUncontrolledCursor(next);
		onCursorChange?.(next);
		blink.hold();
	};

	// Whether the last press was taken by `onClick`, along with its drag.
	const isTakenRef = useRef(false);

	const textRef = useRef<DOMElement | null>(null);
	const { width } = useBoxMetrics(textRef);

	const rows = useMemo(
		() => TextareaUtils.rows({ value, width, cursor: focus ? cursor : null }),
		[value, width, cursor, focus],
	);

	const cursorRow = focus ? TextareaUtils.row({ rows, cursor }) : -1;

	// Rows past half the terminal scroll. Whenever the rows change under it — an
	// edit, a step of the cursor, a resize — the viewport moves only as far as it
	// takes to bring the cursor back into view, and in between it is left
	// wherever the wheel turned it.
	const height = Math.max(1, Math.floor(terminalRows / 2));
	const maxTop = Math.max(0, rows.length - height);
	const [view, setView] = useState({ top: 0, rows });

	let top = Math.min(view.top, maxTop);
	if (view.rows !== rows) {
		top = TextareaUtils.scroll({
			offset: view.top,
			index: cursorRow,
			count: rows.length,
			height,
		});
		setView({ top, rows });
	}

	// The wheel turns over whatever the pointer is resting on, the way it does
	// for every other view, focused or not.
	useMouse({
		handler: (event) => {
			if (event.type !== "wheel" || event.deltaY === 0) return;

			const node = textRef.current;
			if (!node) return;
			if (!MouseUtils.contains(MouseUtils.bounds(node, terminalRows), event))
				return;

			setView((current) => ({
				...current,
				top: Math.min(
					Math.max(
						0,
						Math.min(current.top, maxTop) + event.deltaY * WHEEL_STEP,
					),
					maxTop,
				),
			}));
		},
		isActive: rows.length > height,
	});

	/** Where a point was pressed or dragged to. */
	const pointedAt = (event: { x: number; y: number }) =>
		TextareaUtils.offset(
			value,
			TextareaUtils.position({ value, rows, point: event, offset: top }),
		);

	// Kept out of the middle of anything that goes as one.
	const pointed = (event: { x: number; y: number }, from?: number) => {
		const at = pointedAt(event);
		return snap?.(at, from) ?? at;
	};

	/** Where the cursor lands moving from where it is, kept out of anything that goes as one. */
	const snapped = (to: number) => snap?.(to, offset) ?? to;

	const { selection, setSelection, ...selecting } = useSelection({
		value,
		selection: controlledSelection,
		onSelectionChange,
		isActive: focus,
		expand,
		vertical: (from, direction) =>
			TextareaUtils.vertical({
				value,
				rows,
				cursor: TextareaUtils.cursor(value, from),
				direction,
			}),
		onFocus: moveTo,
	});

	/**
	 * Hands a new value on with the cursor left at an offset into it. The cursor
	 * goes first, so that a parent rewriting the change on its way in has the
	 * last word on where the cursor ends up.
	 */
	const change = (next: string, to: number) => {
		moveTo(to, next);
		if (selection) setSelection(null);
		onChange(next);
	};

	/** Writes text in at the cursor, over whatever is selected. */
	const write = (text: string, isWhole = false) => {
		const [start, end] = selection
			? TextareaUtils.range(selection)
			: [offset, offset];

		history.record("insert", { value, offset }, isWhole);
		change(
			value.slice(0, start) + text + value.slice(end),
			start + text.length,
		);
	};

	/** Makes an edit whole, leaving its selection behind it. */
	const edit = ({ value: next, selection: selected }: TextareaEdit) => {
		const [anchor, focused] = selected;

		if (next !== value) history.record("insert", { value, offset }, true);
		moveTo(focused, next);
		setSelection(anchor === focused ? null : selected);
		if (next !== value) onChange(next);
	};

	/** Takes a range out of the value. */
	const remove = (
		[start, end]: [start: number, end: number],
		isWhole = false,
	) => {
		if (start === end) return;

		history.record("delete", { value, offset }, isWhole);
		change(value.slice(0, start) + value.slice(end), start);
	};

	const { mouseRef } = useMouseInput({
		onClick: ({ event }) => {
			// A click taken from the text area takes the drag after it along.
			isTakenRef.current = !!onClick?.(pointedAt(event));
			if (isTakenRef.current) {
				selecting.forget();
				return;
			}

			selecting.press(pointed(event), event.time);
		},
		onDrag: ({ event }) => {
			if (isTakenRef.current) return;
			selecting.drag(pointed(event, selecting.anchor()));
		},
		isActive: focus,
	});

	// Terminals send their newlines as carriage returns, which the value holds
	// as line feeds.
	usePaste(
		(text) => {
			const pasted = text.replace(/\r\n?/g, "\n");
			if (!pasted) return;

			if (onPaste) onPaste(pasted);
			else write(pasted, true);
		},
		{ isActive: focus },
	);

	useInput(
		(typed, pressed) => {
			// Option and a delete, as a terminal sends it without Alt to put on it:
			// the Emacs Ctrl+W for Option and Backspace, and Alt+D for Option and
			// the forward Delete. Read as the Alt and delete they stand for, by the
			// text area and anyone given the key before it alike.
			const isWordBackspace = pressed.ctrl && typed === "w";
			const isWordDelete = pressed.meta && typed === "d";
			const input = isWordBackspace || isWordDelete ? "" : typed;
			const key: Key =
				isWordBackspace || isWordDelete
					? {
							...pressed,
							ctrl: false,
							meta: true,
							backspace: isWordBackspace,
							delete: isWordDelete,
						}
					: pressed;

			// A selection in the chat takes the keys a selection answers from the
			// text area, and is left behind by any other.
			if (selecting.isHeldElsewhere(input, key)) return;

			const taken = onKey?.(input, key);
			if (taken === true) return;
			if (taken) {
				edit(taken);
				return;
			}

			const isArrow =
				key.upArrow || key.downArrow || key.leftArrow || key.rightArrow;

			// Enter breaks the line, and under a modifier hands the value on.
			const isSubmit = key.return && (key.ctrl || key.meta || key.super);
			const isShiftEnter = key.return && key.shift;

			if (isSubmit) {
				onSubmit?.(value);
				return;
			}

			if (key.return || isShiftEnter) {
				if (onEnter && !isShiftEnter) onEnter();
				else write("\n");
				return;
			}

			// Shift and an arrow stretch the selection, from the cursor; Ctrl+A
			// takes it all, and Ctrl+C copies it.
			if (selecting.handleKey(input, key, offset)) return;

			// An arrow collapses the selection to the side it points at, rather
			// than stepping from the end the cursor happens to be on.
			if (isArrow && selection) {
				const [start, end] = TextareaUtils.range(selection);
				moveTo(key.leftArrow || key.upArrow ? start : end);
				setSelection(null);
				return;
			}

			// Word motion, which terminals send in two shapes: an arrow under Alt,
			// and the Emacs Alt+B and Alt+F — which is what macOS Terminal sends for
			// Option and an arrow.
			const isWordBack = key.meta && (key.leftArrow || input === "b");
			const isWordForward = key.meta && (key.rightArrow || input === "f");
			if (isWordBack || isWordForward) {
				if (selection) setSelection(null);
				moveTo(
					snapped(
						isWordBack
							? TextareaUtils.wordStart(value, offset)
							: TextareaUtils.wordEnd(value, offset),
					),
				);
				return;
			}

			if (key.leftArrow || key.rightArrow) {
				moveTo(
					snapped(
						key.leftArrow
							? TextareaUtils.previous(value, offset)
							: TextareaUtils.next(value, offset),
					),
				);
				return;
			}

			// There is no row above the first, so Up there goes to the start of
			// the value, and Down on the last to its end.
			if (key.upArrow || key.downArrow) {
				moveTo(
					snapped(
						TextareaUtils.vertical({
							value,
							rows,
							cursor,
							direction: key.upArrow ? -1 : 1,
						}),
					),
				);
				return;
			}

			// A delete takes the selection out whole, and otherwise a character —
			// or a word under Alt — stretched over anything it reaches into that
			// goes as one.
			if (key.backspace || key.delete) {
				if (selection) {
					remove(TextareaUtils.range(selection));
					return;
				}

				const reached: TextareaSelection = key.backspace
					? [
							key.meta
								? TextareaUtils.wordStart(value, offset)
								: TextareaUtils.previous(value, offset),
							offset,
						]
					: [
							offset,
							key.meta
								? TextareaUtils.wordEnd(value, offset)
								: TextareaUtils.next(value, offset),
						];

				remove(TextareaUtils.range(expand?.(reached) ?? reached), key.meta);
				return;
			}

			// Cut, which takes the selection out and hands it to the clipboard.
			if (key.ctrl && input === "x") {
				if (!selection) return;

				selecting.copy();
				remove(TextareaUtils.range(selection), true);
				return;
			}

			// Undo, and redo under Ctrl+Y or Ctrl+Shift+Z — which a terminal can
			// only tell from Ctrl+Z over the kitty protocol.
			const letter = input.toLowerCase();
			if (key.ctrl && (letter === "z" || letter === "y")) {
				const isUndo = letter === "z" && !key.shift;
				const entry = (isUndo ? history.undo : history.redo)({
					value,
					offset,
				});
				if (entry) change(entry.value, entry.offset);
				return;
			}

			// Any other key leaves the selection behind rather than acting on it.
			if (key.ctrl || key.escape || key.tab || !input) {
				if (selection) setSelection(null);
				return;
			}

			write(input);
		},
		{ isActive: focus },
	);

	const textStyle = useMemo(
		() => textProps({ color: colorScheme.text, ...styles?.text }),
		[colorScheme, styles],
	);

	const painted = useMemo(
		() => TextareaUtils.paint(value, labels ?? []),
		[value, labels],
	);
	const placeholderPainted = useMemo(
		() => TextareaUtils.paint(placeholder ?? "", labels ?? []),
		[placeholder, labels],
	);

	const [selectedStart, selectedEnd] = selection
		? TextareaUtils.range(selection)
		: [0, 0];

	/**
	 * Draws a run of text in the runs of its labels, with the cursor at an
	 * offset into it, or -1 where it is not drawn.
	 *
	 * @param start Where the text starts, in the value its labels are painted over.
	 * @param isDimmed Whether it is the placeholder, which is drawn dimmed — all
	 * but the cursor.
	 */
	const draw = ({
		text,
		start,
		paints,
		cursorAt,
		isDimmed = false,
	}: {
		text: string;
		start: number;
		paints: TextareaPaint[];
		cursorAt: number;
		isDimmed?: boolean;
	}) => {
		const nodes: ReactNode[] = [];
		let run = "";
		let runPaint: TextareaPaint | null = null;
		let runDim = false;

		const flush = () => {
			if (!run || !runPaint) return;

			const props = textProps({
				...TextareaUtils.style(styles, runPaint.label),
				...runPaint.style,
			});

			nodes.push(
				<Text key={nodes.length} {...props} dimColor={runDim}>
					{run}
				</Text>,
			);
			run = "";
		};

		const append = (cell: string, paint: TextareaPaint, dim: boolean) => {
			if (paint !== runPaint || dim !== runDim) flush();
			runPaint = paint;
			runDim = dim;
			run += cell;
		};

		for (const { segment, index } of TextareaUtils.graphemes(text)) {
			const at = start + index;
			const display = segment === "\t" ? " ".repeat(TAB_WIDTH) : segment;
			const isCursor = index === cursorAt && blink.isVisible;

			const paint =
				!isDimmed && at >= selectedStart && at < selectedEnd
					? SELECTION_PAINT
					: (paints[at] ?? TEXT_PAINT);

			// A tab is drawn as spaces, the cursor on the first of them.
			const cell = !isCursor
				? display
				: segment === "\t"
					? inverse(" ") + display.slice(1)
					: inverse(display);

			append(cell, paint, isDimmed && !isCursor);
		}

		// The cursor past the end of the text, on a cell of its own.
		if (cursorAt === text.length) {
			append(blink.isVisible ? inverse(" ") : " ", TEXT_PAINT, false);
		}

		flush();

		if (nodes.length === 0) nodes.push(<Text key={0}> </Text>);

		return nodes;
	};

	const lineStarts = useMemo(() => {
		const starts = [0];
		for (let index = 0; index < value.length; index++) {
			if (value[index] === "\n") starts.push(index + 1);
		}
		return starts;
	}, [value]);

	const drawRow = (row: TextareaRow, index: number) => {
		// The placeholder stands in the first row while there is nothing else.
		if (!value && placeholder) {
			const [line] = placeholder.split("\n");
			return draw({
				text: line,
				start: 0,
				paints: placeholderPainted,
				cursorAt: focus ? 0 : -1,
				isDimmed: true,
			});
		}

		const start = (lineStarts[row.line] ?? 0) + row.column;
		return draw({
			text: row.text,
			start,
			paints: painted,
			cursorAt: index === cursorRow ? offset - start : -1,
		});
	};

	const ref = useMergedRef(textRef, mouseRef);

	return (
		<Box ref={ref} flexGrow={1} flexDirection="column">
			{rows.slice(top, top + height).map((row, index) => (
				<Text key={`${row.line}:${row.column}`} {...textStyle} wrap="wrap">
					{drawRow(row, top + index)}
				</Text>
			))}
		</Box>
	);
}
