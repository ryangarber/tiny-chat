/** biome-ignore-all lint/suspicious/noArrayIndexKey: tests */

import { stripVTControlCharacters } from "node:util";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import Box from "#tui/core/components/Box.tsx";
import Content, { ContentFullscreen } from "#tui/core/components/Content.tsx";
import ScrollView, {
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { render } from "#tui/core/utils/RenderTestUtils.tsx";

const rows = (screen: { lastFrame: () => string | undefined }) =>
	stripVTControlCharacters(screen.lastFrame() ?? "").split("\n");

/** The row of the frame the block's buttons are drawn on. */
const buttonsRow = (screen: { lastFrame: () => string | undefined }) =>
	rows(screen).findIndex((row) => row.includes("[copy]"));

describe("Content", () => {
	it("keeps its buttons on the top row shown of it as it scrolls", async () => {
		const ref = createRef<NonNullable<ScrollViewProps["ref"]>["current"]>();
		// A block of 2 border rows and 20 lines, and more after it, through 8 rows.
		const screen = render(
			<Box height={8} width={40} flexDirection="column">
				<ScrollView ref={ref} flexGrow={1} scrollbar={false}>
					<Content formatter={() => "text"}>
						{Array.from({ length: 20 }, (_, index) => (
							<Text key={`line${index}`}>line{index}</Text>
						))}
					</Content>
					{Array.from({ length: 10 }, (_, index) => (
						<Text key={`after${index}`}>after{index}</Text>
					))}
				</ScrollView>
			</Box>,
		);
		await screen.idle();
		// Just inside the border, beside the first line.
		expect(buttonsRow(screen)).toBe(2);
		expect(rows(screen)[2]).toContain("line1");

		// Its top scrolled away, they ride the first row still shown.
		ref.current?.scrollTo(6);
		await screen.idle();
		expect(buttonsRow(screen)).toBe(0);
		expect(rows(screen)[0]).toContain("line5");

		// Down to its last line, they stop there...
		ref.current?.scrollTo(20);
		await screen.idle();
		expect(buttonsRow(screen)).toBe(0);
		expect(rows(screen)[0]).toContain("line19");

		// ...and leave with it, never drawn over its border.
		ref.current?.scrollTo(21);
		await screen.idle();
		expect(buttonsRow(screen)).toBe(-1);
		expect(rows(screen)[0]).toContain("╰");
	});
});

describe("ContentFullscreen", () => {
	const ESCAPE = "\x1b";
	const CTRL_S = "\x13";

	/** Presses the first `[label]` button on screen, drawn from the 24-row terminal's top. */
	const pressButton = async (
		screen: ReturnType<typeof render>,
		label: string,
	) => {
		const frame = rows(screen);
		const row = frame.findIndex((line) => line.includes(`[${label}]`));
		const column = frame[row].indexOf(`[${label}]`) + 2;
		const top = 24 - frame.length;
		const at = `${column};${top + row + 1}`;
		screen.stdin.write(`\x1b[<0;${at}M\x1b[<0;${at}m`);
		await screen.idle();
	};

	// As the app draws it: over a page filling the terminal.
	const editable = (saved: string[]) => (
		<Box flexDirection="column" height={24}>
			<Content
				formatter={() => "hello"}
				edit={{
					value: "hello",
					save: async (value) => {
						saved.push(value);
					},
				}}
			>
				<Text>hello</Text>
			</Content>
			<ContentFullscreen />
		</Box>
	);

	it("edits an open block's text and saves it", async () => {
		const saved: string[] = [];
		const screen = render(editable(saved));
		await screen.idle();
		// Only offered once opened over the screen.
		expect(rows(screen).join("\n")).not.toContain("[edit]");

		await pressButton(screen, "+");
		expect(rows(screen).join("\n")).toContain("[edit]");

		screen.stdin.write("e");
		await screen.idle();
		expect(rows(screen).join("\n")).toContain("[save]");

		screen.stdin.write("> ");
		await screen.idle();
		screen.stdin.write(CTRL_S);
		await screen.idle();
		expect(saved).toEqual(["> hello"]);
		expect(rows(screen).join("\n")).toContain("[edit]");
		screen.cleanup();
	});

	it("asks for a second Escape before throwing changes away", async () => {
		const saved: string[] = [];
		const screen = render(editable(saved));
		await screen.idle();
		await pressButton(screen, "+");
		await pressButton(screen, "edit");

		screen.stdin.write("x");
		await screen.idle();
		// Escape crosses two ambiguity timers before it arrives as a key.
		screen.stdin.write(ESCAPE);
		await vi.waitFor(() =>
			expect(rows(screen).join("\n")).toContain("again to discard changes"),
		);

		screen.stdin.write(ESCAPE);
		await vi.waitFor(() => expect(rows(screen).join("\n")).toContain("[edit]"));
		expect(rows(screen).join("\n")).not.toContain("xhello");
		expect(saved).toEqual([]);
		screen.cleanup();
	});
});
