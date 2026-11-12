import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import Box from "#tui/core/components/Box.tsx";
import ScrollView from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { render } from "#tui/core/utils/RenderTestUtils.tsx";

/** SGR wheel report at a 1-based column and row: 64 turns it up, 65 down. */
const wheel = (direction: "up" | "down", row: number) =>
	`\x1b[<${direction === "up" ? 64 : 65};5;${row}M`;

/** PageUp and PageDown, as a terminal sends them — and Fn+↑↓ on a Mac. */
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";

/** SGR press, drag and release of the left button at a 1-based column and row. */
const press = (column: number, row: number) => `\x1b[<0;${column};${row}M`;
const drag = (column: number, row: number) => `\x1b[<32;${column};${row}M`;
const release = (column: number, row: number) => `\x1b[<0;${column};${row}m`;

/**
 * The frame as plain text. Colors are only written where the environment asks
 * for them (`FORCE_COLOR`, as agents and CI set), so rows are compared without.
 */
const plain = (screen: { lastFrame: () => string | undefined }) =>
	stripVTControlCharacters(screen.lastFrame() ?? "");

/** The first word of a row of the frame, leaving the scrollbar out of it. */
const firstWord = (frame: string | undefined, row = 0) =>
	frame?.split("\n")[row]?.trim().split(/\s+/)[0];

/** The rows of the frame the scrollbar's handle is drawn on. */
const thumbRows = (frame: string | undefined) =>
	(frame?.split("\n") ?? []).flatMap((line, row) =>
		line.endsWith("▐") ? [row] : [],
	);

const lines = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, index) => `${prefix}${index}`).map(
		(line) => <Text key={line}>{line}</Text>,
	);

// A transcript filling the terminal, ending in a tail held to five rows.
const tree = (
	<Box height={24} flexDirection="column">
		<ScrollView flexGrow={1} stickToBottom>
			{lines("outer", 30)}
			<ScrollView
				key="tail"
				maxHeight={5}
				flexShrink={0}
				stickToBottom
				overscan={Number.POSITIVE_INFINITY}
			>
				{lines("inner", 20)}
			</ScrollView>
		</ScrollView>
	</Box>
);

describe("nested scroll views", () => {
	it("hands the wheel to a nested view until it reaches its edge", async () => {
		const screen = render(tree);
		await screen.idle();
		expect(plain(screen)).toContain("inner19");
		expect(plain(screen)).toContain("outer29");

		// Over the tail: it lets go of its end, and the transcript stays put.
		screen.stdin.write(wheel("up", 22));
		await screen.idle();
		expect(plain(screen)).not.toContain("inner19");
		expect(plain(screen)).toContain("inner14");
		expect(plain(screen)).toContain("outer29");

		// Once the tail is at its top, the transcript takes over.
		for (let turn = 0; turn < 10; turn++) screen.stdin.write(wheel("up", 22));
		await screen.idle();
		expect(plain(screen)).not.toContain("outer29");
		expect(plain(screen)).toContain("outer0");

		// Back down: the transcript returns, then the tail picks its end back up.
		for (let turn = 0; turn < 20; turn++) screen.stdin.write(wheel("down", 22));
		await screen.idle();
		expect(plain(screen)).toContain("outer29");
		expect(plain(screen)).toContain("inner19");
		screen.cleanup();
	});

	it("hands a flick on to a nested view it carries under the pointer", async () => {
		const screen = render(tree);
		await screen.idle();
		for (let turn = 0; turn < 10; turn++) screen.stdin.write(wheel("up", 22));
		await screen.idle();
		expect(plain(screen)).toContain("outer0");

		// One read, as a terminal sends a fast flick: the transcript reaches its
		// end before it is drawn there, and the turns left over belong to the tail.
		screen.stdin.write(wheel("down", 22).repeat(20));
		await screen.idle();
		expect(plain(screen)).toContain("outer29");
		expect(plain(screen)).toContain("inner19");
		screen.cleanup();
	});

	it("sizes a view bounded only by a maxHeight to content that fits", async () => {
		const screen = render(
			<Box flexDirection="column">
				<ScrollView maxHeight={10} flexShrink={0} stickToBottom>
					{lines("short", 2)}
				</ScrollView>
				<Text>after</Text>
			</Box>,
		);
		await screen.idle();
		expect(plain(screen).split("\n").slice(0, 3)).toEqual([
			"short0",
			"short1",
			"after",
		]);
		screen.cleanup();
	});
});

describe("paging", () => {
	it("moves a page at a time, keeping two rows of context", async () => {
		const screen = render(
			<Box height={10} flexDirection="column">
				<ScrollView flexGrow={1} paging>
					{lines("row", 40)}
				</ScrollView>
			</Box>,
		);
		await screen.idle();
		expect(firstWord(plain(screen))).toBe("row0");

		screen.stdin.write(PAGE_DOWN);
		await screen.idle();
		expect(firstWord(plain(screen))).toBe("row8");

		screen.stdin.write(PAGE_UP);
		await screen.idle();
		expect(firstWord(plain(screen))).toBe("row0");
		screen.cleanup();
	});

	it("leaves a view without it where it is", async () => {
		const screen = render(
			<Box height={10} flexDirection="column">
				<ScrollView flexGrow={1}>{lines("row", 40)}</ScrollView>
			</Box>,
		);
		await screen.idle();
		screen.stdin.write(PAGE_DOWN);
		await screen.idle();
		expect(firstWord(plain(screen))).toBe("row0");
		screen.cleanup();
	});
});

describe("scrollbar", () => {
	// The tree is drawn against the bottom of the test's 24-row terminal, so a
	// row of the view is reported 14 rows further down.
	const at = (row: number) => row + 14;

	const view = (
		<Box height={10} flexDirection="column">
			<ScrollView flexGrow={1}>{lines("row", 40)}</ScrollView>
		</Box>
	);

	it("is only drawn while the content overflows", async () => {
		const screen = render(
			<Box height={10} flexDirection="column">
				<ScrollView flexGrow={1}>{lines("row", 5)}</ScrollView>
			</Box>,
		);
		await screen.idle();
		expect(thumbRows(plain(screen))).toEqual([]);
		screen.cleanup();
	});

	it("sizes the handle to the share of the content in view", async () => {
		const screen = render(view);
		await screen.idle();
		// 10 of 40 rows: a handle of 3 rows (10 × 10 / 40, rounded), at the top.
		expect(thumbRows(plain(screen))).toEqual([0, 1, 2]);
		screen.cleanup();
	});

	it("scrolls by dragging the handle, held to the track outside the view", async () => {
		const screen = render(view);
		await screen.idle();
		const columns = 100;

		screen.stdin.write(press(columns, at(1)));
		screen.stdin.write(drag(columns, at(4)));
		await screen.idle();
		expect(thumbRows(plain(screen))).toEqual([3, 4, 5]);
		expect(firstWord(plain(screen))).not.toBe("row0");

		// Out past the bottom, and off to the side: only the row counts, and it
		// stops at the end of the track.
		screen.stdin.write(drag(1, at(40)));
		await screen.idle();
		expect(firstWord(plain(screen), 9)).toBe("row39");
		expect(thumbRows(plain(screen))).toEqual([7, 8, 9]);

		// And back above the top.
		screen.stdin.write(drag(1, at(1)));
		screen.stdin.write(release(1, at(1)));
		await screen.idle();
		expect(firstWord(plain(screen))).toBe("row0");

		// Released, the pointer no longer moves it.
		screen.stdin.write(drag(columns, at(8)));
		await screen.idle();
		expect(firstWord(plain(screen))).toBe("row0");
		screen.cleanup();
	});

	it("jumps to where the track is pressed beside the handle", async () => {
		const screen = render(view);
		await screen.idle();
		screen.stdin.write(press(100, at(10)));
		screen.stdin.write(release(100, at(10)));
		await screen.idle();
		expect(thumbRows(plain(screen))).toEqual([7, 8, 9]);
		expect(firstWord(plain(screen), 9)).toBe("row39");
		screen.cleanup();
	});

	it("still takes the wheel over the handle", async () => {
		const screen = render(view);
		await screen.idle();
		screen.stdin.write(`\x1b[<65;100;${at(2)}M`);
		await screen.idle();
		expect(firstWord(plain(screen))).toBe("row3");
		screen.cleanup();
	});
});

function ClickableRow({
	label,
	onClick,
}: {
	label: string;
	onClick: (label: string) => void;
}) {
	const { mouseRef } = useMouseInput({ onClick: () => onClick(label) });
	return (
		<Box ref={mouseRef}>
			<Text>{label}</Text>
		</Box>
	);
}

describe("clicks", () => {
	it("only reaches the rows a view shows, not those laid out past its edges", async () => {
		const clicked: string[] = [];
		const screen = render(
			<Box height={10} flexDirection="column">
				<ScrollView height={5} flexShrink={0}>
					{Array.from({ length: 20 }, (_, index) => `row${index}`).map(
						(label) => (
							<ClickableRow
								key={label}
								label={label}
								onClick={(row) => clicked.push(row)}
							/>
						),
					)}
				</ScrollView>
				<Text>below</Text>
			</Box>,
		);
		await screen.idle();
		// Drawn against the bottom of the 24-row terminal, from row 15.
		screen.stdin.write(press(3, 15 + 7) + release(3, 15 + 7));
		await screen.idle();
		expect(clicked).toEqual([]);

		screen.stdin.write(press(3, 15 + 2) + release(3, 15 + 2));
		await screen.idle();
		expect(clicked).toEqual(["row2"]);
		screen.cleanup();
	});
});
