import {
	Children,
	cloneElement,
	createContext,
	isValidElement,
	type ReactNode,
	useContext,
	useMemo,
} from "react";
import Box from "#tui/core/components/Box.tsx";
import Content, { ContentWidthContext } from "#tui/core/components/Content.tsx";
import Divider from "#tui/core/components/Divider.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useWidth } from "#tui/core/hooks/useWidth.ts";

type Align = "left" | "center" | "right";

interface ColumnInfo {
	width: number;
	align: Align;
}

const ColumnsContext = createContext<ColumnInfo[]>([]);

const GUTTER = 1; // padding chars on each side of a cell's content
const MIN_COL_WIDTH = GUTTER * 2 + 10;

// Flatten an already-built React child tree down to its plain text.
// Works regardless of which components a-tags/em/strong/code were mapped to.
function toText(node: ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean") {
		return "";
	}

	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(toText).join("");
	}

	if (isValidElement(node)) {
		return toText((node.props as any)?.children);
	}

	return "";
}

// remark-gfm table alignment is converted by hast-util-to-jsx-runtime into a
// real style object (tableCellAlignToStyle: true, the default), with DOM
// casing — so `style.textAlign`, not a `text-align` string.

function alignFromProps(props: any): Align {
	const textAlign = props?.style?.textAlign;
	if (textAlign === "right" || textAlign === "end") return "right";
	if (textAlign === "center") return "center";
	return "left";
}

interface CellData {
	text: string;
	align: Align;
}

interface RowData {
	cells: CellData[];
}

// Walk table's children (thead/tbody -> tr -> th/td) collecting text +
// alignment per cell, without rendering anything yet.
function collectRows(children: ReactNode): RowData[] {
	const rows: RowData[] = [];

	Children.forEach(children, (section) => {
		if (!isValidElement(section)) return;

		// Normally thead/tbody, but tolerate a stray <tr> directly under <table>.

		const sectionRows =
			section.type === TrComponent
				? [section]
				: Children.toArray((section.props as any).children);

		Children.forEach(sectionRows as ReactNode, (row) => {
			if (!isValidElement(row)) return;

			const cells: CellData[] = [];

			Children.forEach((row.props as any).children, (cell) => {
				if (!isValidElement(cell)) return;
				cells.push({
					text: toText((cell.props as any).children),
					align: alignFromProps(cell.props),
				});
			});

			if (cells.length > 0) rows.push({ cells });
		});
	});

	return rows;
}

const SEPARATORS: Record<Align, string> = {
	left: "---",
	center: ":---:",
	right: "---:",
};

// The table back as markdown, the format the app copies first. The first row is
// taken as the header, since that is the row markdown requires.
function toMarkdown(children: ReactNode): string {
	const rows = collectRows(children);
	const colCount = rows.reduce(
		(max, row) => Math.max(max, row.cells.length),
		0,
	);
	if (colCount === 0) return "";

	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	const cellsOf = (row: RowData) =>
		Array.from({ length: colCount }, (_, i) =>
			(row.cells[i]?.text ?? "").replaceAll("|", "\\|").replaceAll("\n", " "),
		);

	const [header, ...body] = rows;
	return [
		line(cellsOf(header)),
		line(
			Array.from(
				{ length: colCount },
				(_, i) => SEPARATORS[header.cells[i]?.align ?? "left"],
			),
		),
		...body.map((row) => line(cellsOf(row))),
	].join("\n");
}

function computeColumns(
	children: ReactNode,
	availableWidth: number,
): ColumnInfo[] {
	const rows = collectRows(children);
	const colCount = rows.reduce(
		(max, row) => Math.max(max, row.cells.length),
		0,
	);
	if (colCount === 0) return [];

	const natural = new Array<number>(colCount).fill(0);
	const align = new Array<Align>(colCount).fill("left");

	for (const row of rows) {
		row.cells.forEach((cell, i) => {
			natural[i] = Math.max(natural[i], cell.text.length);
			if (cell.align !== "left") align[i] = cell.align;
		});
	}

	const padded = natural.map((w) => w + GUTTER * 2);
	const paddedTotal = padded.reduce((a, b) => a + b, 0);

	// Columns are set apart by their gutters alone, with no separator drawn.
	const usable = Math.max(colCount * MIN_COL_WIDTH, availableWidth);

	if (paddedTotal <= usable) {
		// Content fits: give every column its natural width, then distribute
		// the leftover proportionally so the table still fills the terminal.
		const leftover = usable - paddedTotal;
		return padded.map((w, i) => ({
			width: w + Math.floor((leftover * w) / paddedTotal),
			align: align[i],
		}));
	}

	// Doesn't fit: shrink proportionally (never below a usable minimum).
	// Text.wrap="wrap" on the cell then takes care of wrapping overflow.
	return padded.map((w, i) => ({
		width: Math.max(MIN_COL_WIDTH, Math.floor((w / paddedTotal) * usable)),
		align: align[i],
	}));
}

/**
 * ---------------------------------------------------------------------------
 * Components
 * ---------------------------------------------------------------------------
 */

export function TableComponent({ children }: { children?: ReactNode }) {
	return (
		<Content formatter={() => toMarkdown(children)}>
			<TableLayout>{children}</TableLayout>
		</Content>
	);
}

/**
 * Sizes the columns to wherever the table is drawn: its message, or the whole
 * screen once opened with `[+]`, which draws these same children again.
 */
function TableLayout({ children }: { children?: ReactNode }) {
	const terminalWidth = useWidth();
	const fullscreenWidth = useContext(ContentWidthContext);

	const width = fullscreenWidth ?? Math.max(20, terminalWidth - 4);

	// Recompute only when the row content or the width changes.
	const columns = useMemo(
		() => computeColumns(children, width - 4),
		[children, width],
	);

	return (
		<Box flexDirection="column" width={width} paddingX={2} paddingY={1}>
			<ColumnsContext.Provider value={columns}>
				{children}
			</ColumnsContext.Provider>
		</Box>
	);
}

export function TheadComponent({ children }: { children?: ReactNode }) {
	return (
		// borderStyle + disabling every side but bottom draws a single rule
		// under the header row, mimicking a markdown table's separator line.
		<Box flexDirection="column">
			{children}
			<Divider />
		</Box>
	);
}

export function TbodyComponent({ children }: { children?: ReactNode }) {
	return (
		<Box flexDirection="column" gap={1}>
			{children}
		</Box>
	);
}

export function TrComponent({ children }: { children?: ReactNode }) {
	const cells = Children.toArray(children);

	return (
		<Box flexDirection="row">
			{cells.map((cell, i) =>
				isValidElement(cell)
					? // biome-ignore lint/suspicious/noArrayIndexKey: cells stay in order
						cloneElement(cell as any, { __columnIndex: i, key: i })
					: cell,
			)}
		</Box>
	);
}

interface CellProps {
	children?: ReactNode;
	__columnIndex?: number;
}

function justifyFor(align: Align) {
	if (align === "right") return "flex-end";
	if (align === "center") return "center";
	return "flex-start";
}

function Cell({
	children,
	columnIndex,
	bold,
}: {
	children?: ReactNode;
	columnIndex?: number;
	bold?: boolean;
}) {
	const columns = useContext(ColumnsContext);
	const col = columns[columnIndex ?? -1] ?? {
		width: 10,
		align: "left" as Align,
	};

	return (
		<Box
			width={col.width}
			paddingX={GUTTER}
			justifyContent={justifyFor(col.align)}
		>
			<Text bold={bold} wrap="wrap">
				{children}
			</Text>
		</Box>
	);
}

export function ThComponent({ children, __columnIndex }: CellProps) {
	return (
		<Cell columnIndex={__columnIndex} bold>
			{children}
		</Cell>
	);
}

export function TdComponent({ children, __columnIndex }: CellProps) {
	return <Cell columnIndex={__columnIndex}>{children}</Cell>;
}
