import {
	type DOMElement,
	type Key,
	measureElement,
	useInput,
	useWindowSize,
} from "ink";
import {
	createContext,
	type ReactNode,
	type Ref,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { useMergedRef } from "#client/core/hooks/useMergedRef.ts";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouse } from "#tui/core/hooks/useMouse.ts";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import { type MousePoint, MouseUtils } from "#tui/core/utils/MouseUtils.ts";
import {
	type TextLayout,
	TextLayoutUtils,
	type TextRow,
} from "#tui/core/utils/TextLayoutUtils.ts";
import {
	SELECTION_STYLE,
	useSelection,
} from "#tui/features/selection/hooks/useSelection.ts";
import type { TextareaSelection } from "#tui/features/textarea/types/textarea.ts";

/**
 * How often a held selection looks again at what is drawn, as Ink has nothing
 * like a mutation observer: content streaming in under it, a resize.
 */
const POLL_INTERVAL = 100;

/** Something to do with what is selected, offered over it while it is. */
export interface SelectionAction {
	label: string;
	onSelect: (text: string) => void;
}

/** The actions a selection made inside offers — a model's reply offers to quote it. */
export const SelectionActionsContext = createContext<SelectionAction[]>([]);

/** Whether a selectable is drawn inside another, which selects for it. */
const SelectableContext = createContext(false);

/** A block of the text drawn, from `start` in the text as a whole. */
interface SelectableBlock {
	node: DOMElement;
	text: string;
	start: number;
	layout: TextLayout | null | undefined;
}

/** What is drawn, read as one run of text: its blocks, a line apiece. */
interface SelectableText {
	blocks: SelectableBlock[];
	value: string;
}

const EMPTY: SelectableText = { blocks: [], value: "" };

const layoutOf = (block: SelectableBlock) => {
	if (block.layout === undefined)
		block.layout = TextLayoutUtils.layout(block.node);
	return block.layout;
};

/** The last line of a block that anything is drawn on. */
const lastLine = (layout: TextLayout) =>
	layout.cells.reduce((last, cell) => Math.max(last, cell?.line ?? 0), 0);

const isSame = (a: TextRow[], b: TextRow[]) =>
	a.length === b.length &&
	a.every(
		(row, i) => row.x === b[i].x && row.y === b[i].y && row.text === b[i].text,
	);

/**
 * Text that can be selected, as it can in the app wherever it is marked
 * selectable: a message's Markdown, a block of content. Whatever is drawn
 * inside is read back off the screen, a block of text to a line, and selected
 * out of as the composer is (see {@link useSelection}) — dragged over with the
 * mouse, stretched with Shift and the arrows once there is a selection, taken
 * whole with Ctrl+A and copied with Ctrl+C — and drawn over the way the
 * terminal draws its own selection. Escape, or a click anywhere else, lets
 * it go.
 *
 * One drawn inside another leaves its text to the outer one, so a selection
 * runs on from a paragraph into the block of code after it.
 */
export default function Selectable({
	children,
	ref: _ref,
	...props
}: BoxProps & { ref?: Ref<DOMElement>; children?: ReactNode }) {
	const isNested = useContext(SelectableContext);
	const actions = useContext(SelectionActionsContext);
	const { rows: terminalRows } = useWindowSize();

	const ref = useRef<DOMElement>(null);
	const highlightsRef = useRef<DOMElement>(null);
	const barRef = useRef<DOMElement>(null);

	// Read off the screen as a gesture starts, and kept through it.
	const textRef = useRef<SelectableText>(EMPTY);

	const read = () => {
		const root = ref.current;
		if (!root) return EMPTY;

		const blocks: SelectableBlock[] = [];
		let value = "";
		for (const node of TextLayoutUtils.blocks(root, [
			highlightsRef.current,
			barRef.current,
		])) {
			const text = TextLayoutUtils.text(node);
			if (!text) continue;
			if (blocks.length) value += "\n";
			blocks.push({ node, text, start: value.length, layout: undefined });
			value += text;
		}

		textRef.current = { blocks, value };
		return textRef.current;
	};

	/**
	 * The offset a point lands on, in Ink's coordinates. Of the blocks drawn on
	 * its row, it is the one furthest along that starts at or before it — the
	 * cell of a table it is in — and between rows, the end of the block above.
	 */
	const offsetAt = (point: MousePoint) => {
		let on: { block: SelectableBlock; layout: TextLayout } | null = null;
		let above = 0;
		for (const block of textRef.current.blocks) {
			const layout = layoutOf(block);
			if (!layout) continue;
			if (point.y < layout.y) continue;
			if (point.y > layout.y + lastLine(layout)) {
				above = Math.max(above, block.start + block.text.length);
				continue;
			}
			if (!on || layout.x <= point.x) on = { block, layout };
		}
		if (!on) return above;
		const { block, layout } = on;
		return block.start + TextLayoutUtils.offset(layout, block.text, point);
	};

	/** Where the character at an offset is drawn, in Ink's coordinates. */
	const pointAt = (offset: number): MousePoint | null => {
		const block = textRef.current.blocks.findLast(
			(block) => block.start <= offset,
		);
		const layout = block && layoutOf(block);
		if (!block || !layout) return null;
		return TextLayoutUtils.point(
			layout,
			block.text,
			Math.min(offset - block.start, block.text.length),
		);
	};

	/** A point the mouse reported, from the top left of this element, in Ink's coordinates. */
	const toLayout = (event: MousePoint) => {
		const root = ref.current;
		if (!root) return event;
		const { x, y } = measureElement(root);
		return { x: x + event.x, y: y + event.y };
	};

	const selecting = useSelection({
		value: () => textRef.current.value,
		isActive: !isNested,
		vertical: (from, direction) => {
			const point = pointAt(from);
			if (!point) return from;
			return offsetAt({ x: point.x, y: point.y + direction });
		},
	});
	const { selection, setSelection } = selecting;

	const { mouseRef } = useMouseInput({
		onClick: ({ event }) => {
			read();
			selecting.press(offsetAt(toLayout(event)), event.time);
		},
		onDrag: ({ event }) => selecting.drag(offsetAt(toLayout(event))),
		isActive: !isNested,
	});

	// A press anywhere else lets the selection go, but for one on what is
	// offered over it.
	useMouse({
		handler: (event) => {
			const root = ref.current;
			if (event.type !== "down" || !root) return;
			const bar = barRef.current;
			if (
				bar &&
				MouseUtils.contains(MouseUtils.bounds(bar, terminalRows), event)
			)
				return;
			const isInside =
				MouseUtils.contains(MouseUtils.bounds(root, terminalRows), event) &&
				!MouseUtils.isCovered(root, event, terminalRows);
			if (!isInside) setSelection(null);
		},
		isActive: !!selection,
	});

	// The keys only go here while the selection held is this one.
	useInput(
		(input: string, key: Key) => {
			if (key.escape) {
				setSelection(null);
				return;
			}
			// Read again, for anything that has come in since.
			read();
			selecting.handleKey(input, key);
		},
		{ isActive: !!selection },
	);

	const [highlights, setHighlights] = useState<TextRow[]>([]);

	// Read from the layout Ink computed for the last frame, which is only there
	// once that frame is committed.
	const measure = useEffectEvent((selected: TextareaSelection | null) => {
		const root = ref.current;
		let next: TextRow[] = [];
		if (root && selected) {
			const [start, end] =
				selected[0] < selected[1] ? selected : [selected[1], selected[0]];
			const { blocks } = read();
			const pieces = blocks.flatMap((block) => {
				const from = Math.max(start, block.start) - block.start;
				const to = Math.min(end, block.start + block.text.length) - block.start;
				return from < to ? [{ node: block.node, start: from, end: to }] : [];
			});
			next = TextLayoutUtils.rows(root, pieces);
		}
		setHighlights((previous) => (isSame(previous, next) ? previous : next));
	});

	useEffect(() => {
		// biome-ignore lint/nursery/useReactCompiler: the rows are measured from the layout Ink just committed, which render cannot read.
		measure(selection);
		if (!selection) return;
		const interval = setInterval(() => measure(selection), POLL_INTERVAL);
		return () => clearInterval(interval);
	}, [selection]);

	const isOffering = actions.length > 0 && highlights.length > 0;
	useMouseLayer(barRef, isOffering);

	const mergedRef = useMergedRef(ref, mouseRef, _ref);

	if (isNested) return <Box {...props}>{children}</Box>;

	const first = highlights[0];
	const last = highlights.at(-1);

	return (
		<Box ref={mergedRef} flexDirection="column" {...props}>
			<SelectableContext value={true}>{children}</SelectableContext>
			<Box ref={highlightsRef} position="absolute" top={0} left={0}>
				{highlights.map((row) => (
					<Box
						key={`${row.x}:${row.y}`}
						position="absolute"
						top={row.y}
						left={row.x}
					>
						<Text
							color={SELECTION_STYLE.color}
							backgroundColor={SELECTION_STYLE.bgColor}
							wrap="truncate-end"
						>
							{row.text}
						</Text>
					</Box>
				))}
			</Box>
			{isOffering && first && last && (
				// Over the selection, or under it where there is no row above.
				<Box
					ref={barRef}
					position="absolute"
					top={first.y > 0 ? first.y - 1 : last.y + 1}
					left={first.x}
					paddingX={1}
					gap={1}
					backgroundColor="exterior"
				>
					{actions.map((action) => (
						<Button
							key={action.label}
							label={action.label}
							onClick={() => {
								const text = selecting.selected().trim();
								setSelection(null);
								if (text) action.onSelect(text);
							}}
						/>
					))}
				</Box>
			)}
		</Box>
	);
}
