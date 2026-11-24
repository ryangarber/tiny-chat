import { stripVTControlCharacters } from "node:util";
import { Box, ScrollView, type ScrollViewRef, Text } from "better-ink-ui";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { ToolStreamService } from "#client/core/services/StreamService.ts";
import { useChapters } from "#client/features/chapter/hooks/useChapters.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import { mockConfig } from "#core/tests.ts";
import ChapterRail from "#tui/features/chapter/components/ChapterRail.tsx";
import render from "#tui/tests.ts";

/** Lines each message is drawn as. */
const LINES = 8;

const message = (
	id: string,
	author: "USER" | "MODEL",
	data: zData,
): MessageState =>
	({
		id,
		chatId: "chat",
		author,
		data,
		config: mockConfig(),
		previousId: null,
		createdAt: Temporal.Now.instant(),
		updatedAt: null,
	}) as unknown as MessageState;

const text = (id: string, value: string): zData => [
	[{ id: `${id}:t`, type: "text", value }],
];

// A dev server started in the background, still going once the reply ended.
const server: zData = [
	[
		{
			id: "dev",
			type: "toolCall",
			name: "shell_exec",
			input: { command: "pnpm dev", background: true },
		},
		{
			id: "dev",
			type: "toolResult",
			name: "shell_exec",
			output: ToolCallUtils.getBackground({ id: "dev" }),
		},
		{ id: "b:t", type: "text", value: "Started it." },
	],
];

const messages = [
	message("a", "USER", text("a", "Start the server")),
	message("b", "MODEL", server),
	message("c", "USER", text("c", "Now the tests")),
	message("d", "MODEL", text("d", "They pass.")),
];

function Transcript({
	messages: list = messages,
}: {
	messages?: MessageState[];
}) {
	const ref = useRef<ScrollViewRef>(null);
	const { chapters, end } = useChapters({ messages: list });
	return (
		<Box height={10} flexDirection="column">
			<ScrollView
				ref={ref}
				flexGrow={1}
				rail={(rail) => (
					<ChapterRail
						rail={rail}
						chapters={chapters}
						end={end}
						onChapter={(chapter) =>
							chapter.type === "end"
								? ref.current?.scrollToBottom()
								: ref.current?.scrollToIndex(chapter.index, "top")
						}
					/>
				)}
			>
				{list.map((item) => (
					<Box key={item.id} flexDirection="column" height={LINES}>
						<Text>{`${item.id}-first`}</Text>
					</Box>
				))}
			</ScrollView>
		</Box>
	);
}

const plain = (screen: { lastFrame: () => string | undefined }) =>
	stripVTControlCharacters(screen.lastFrame() ?? "");

/** What the rail draws on each row: the column just inside the scrollbar. */
const railOf = (frame: string) =>
	frame.split("\n").map((line) => line.padEnd(100)[98]);

/** SGR press of the left button at a 1-based column and row. */
const press = (column: number, row: number) => `\x1b[<0;${column};${row}M`;

describe("ChapterRail", () => {
	it("marks the user's messages, and a running call only while it streams", async () => {
		const screen = await render(<Transcript />);
		await screen.idle();

		// Listed evenly down the middle of the track above the end's row,
		// whatever the content beneath: rows 3 and 5. Scrolled to the top, the
		// end is shown on the last row.
		expect(railOf(plain(screen))).toEqual([
			" ",
			" ",
			" ",
			"━",
			" ",
			"━",
			" ",
			" ",
			" ",
			"↓",
		]);

		ToolStreamService.start("dev");
		await screen.idle();
		// Between the messages, as its reply is: rows 2, 4 and 6.
		expect(railOf(plain(screen))[4]).toBe("•");

		ToolStreamService.clear("dev");
		await screen.idle();
		expect(railOf(plain(screen))).not.toContain("•");
		screen.cleanup();
	});

	it("scrolls to the message a mark is pressed on", async () => {
		const screen = await render(<Transcript />);
		await screen.idle();
		expect(plain(screen).split("\n")[0]).toContain("a-first");

		// The tree is drawn against the bottom of the 24-row terminal.
		screen.stdin.write(press(99, 5 + 15));
		await screen.idle();
		expect(plain(screen).split("\n")[0]).toContain("c-first");
		screen.cleanup();
	});

	it("marks a lone message, with nothing to scroll", async () => {
		const screen = await render(<Transcript messages={messages.slice(0, 1)} />);
		await screen.idle();
		const rail = railOf(plain(screen));
		expect(rail.filter((mark) => mark === "━")).toHaveLength(1);
		// Centered above the end's row: row 3.5, rounded.
		expect(rail[4]).toBe("━");
		// At the bottom already, so no end.
		expect(rail).not.toContain("↓");
		screen.cleanup();
	});

	it("scrolls to the bottom from the end's mark, which then goes", async () => {
		const screen = await render(<Transcript />);
		await screen.idle();
		expect(plain(screen).split("\n")[0]).toContain("a-first");

		screen.stdin.write(press(99, 9 + 15));
		await screen.idle();
		const frame = plain(screen);
		// 32 rows of content in a 10-row view: d starts on its third row.
		expect(frame.split("\n")[2]).toContain("d-first");
		expect(railOf(frame)).not.toContain("↓");
		screen.cleanup();
	});
});
