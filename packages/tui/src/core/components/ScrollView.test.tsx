import { describe, expect, it } from "vitest";
import Box from "#tui/core/components/Box.tsx";
import ScrollView from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { render } from "#tui/core/utils/RenderTestUtils.tsx";

/** SGR wheel report at a 1-based column and row: 64 turns it up, 65 down. */
const wheel = (direction: "up" | "down", row: number) =>
	`\x1b[<${direction === "up" ? 64 : 65};5;${row}M`;

/** PageUp and PageDown, as a terminal sends them — and Fn+↑↓ on a Mac. */
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";

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
		expect(screen.lastFrame()).toContain("inner19");
		expect(screen.lastFrame()).toContain("outer29");

		// Over the tail: it lets go of its end, and the transcript stays put.
		screen.stdin.write(wheel("up", 22));
		await screen.idle();
		expect(screen.lastFrame()).not.toContain("inner19");
		expect(screen.lastFrame()).toContain("inner14");
		expect(screen.lastFrame()).toContain("outer29");

		// Once the tail is at its top, the transcript takes over.
		for (let turn = 0; turn < 10; turn++) screen.stdin.write(wheel("up", 22));
		await screen.idle();
		expect(screen.lastFrame()).not.toContain("outer29");
		expect(screen.lastFrame()).toContain("outer0");

		// Back down: the transcript returns, then the tail picks its end back up.
		for (let turn = 0; turn < 20; turn++) screen.stdin.write(wheel("down", 22));
		await screen.idle();
		expect(screen.lastFrame()).toContain("outer29");
		expect(screen.lastFrame()).toContain("inner19");
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
		expect(screen.lastFrame()?.split("\n").slice(0, 3)).toEqual([
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
		expect(screen.lastFrame()?.split("\n")[0]).toBe("row0");

		screen.stdin.write(PAGE_DOWN);
		await screen.idle();
		expect(screen.lastFrame()?.split("\n")[0]).toBe("row8");

		screen.stdin.write(PAGE_UP);
		await screen.idle();
		expect(screen.lastFrame()?.split("\n")[0]).toBe("row0");
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
		expect(screen.lastFrame()?.split("\n")[0]).toBe("row0");
		screen.cleanup();
	});
});
