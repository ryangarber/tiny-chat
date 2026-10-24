import { stripVTControlCharacters } from "node:util";
import { Box, Text, useWindowSize } from "ink";
import stringWidth from "string-width";
import { beforeEach, expect, it } from "vitest";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChatSourcesStore } from "#client/features/chat/stores/useChatSourcesStore.ts";
import {
	createMessageStore,
	MessageStoreContext,
} from "#client/features/message/stores/useMessageStore.ts";
import type { Source } from "#core/features/data/utils/SourceUtils.ts";
import { render } from "#tui/core/utils/RenderTestUtils.tsx";
import {
	Citation,
	CitationCard,
	Citations,
} from "#tui/features/message/components/Citation.tsx";

const sources: Source[] = [
	{
		key: "https://example.com/article",
		type: "web",
		value: {
			url: "https://example.com/article",
			title: "An Example Article",
			content: "Some content about the quick brown fox.",
		},
	},
];

/** An SGR press and release at a cell, counted from 0. */
const click = (x: number, y: number) =>
	`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;

/** An SGR report of the pointer moving, no button held, onto a cell. */
const hover = (x: number, y: number) => `\x1b[<35;${x + 1};${y + 1}M`;

beforeEach(() => {
	useLayoutStore.setState({ panels: { chats: false, files: false } });
	useChatSourcesStore.setState({ viewedFile: null });
});

/** Fills the terminal, as the app does, so frame rows are screen rows. */
function Screen() {
	const { rows } = useWindowSize();
	return (
		<Box flexDirection="column" height={rows} width={40}>
			<Text>
				the quick brown fox jumps over the lazy dog
				<Citation
					sourceKey="https://example.com/article"
					sources={sources}
					cited="quick brown fox"
				/>
			</Text>
			<CitationCard />
		</Box>
	);
}

it("renders cited text and updates its citations when sources settle", async () => {
	const store = createMessageStore();
	const screen = render(
		<MessageStoreContext value={store}>
			<Text>
				Cited text
				<Citations sources="/tmp/a file.txt" cited="Cited text" />
			</Text>
		</MessageStoreContext>,
	);
	try {
		expect(screen.lastFrame()).toContain("Cited text");
		expect(screen.lastFrame()).toContain("❔");
		store.setState({
			sources: [
				{
					key: "/tmp/a file.txt",
					type: "file",
					value: { path: "/tmp/a file.txt", directory: false },
				},
			],
		});
		await screen.idle();
		expect(screen.lastFrame()).toContain("Cited text");
		expect(screen.lastFrame()).toContain("📎");
		expect(screen.lastFrame()).not.toContain("❔");
	} finally {
		screen.unmount();
		screen.cleanup();
	}
});

const emoji = (frame: string) => {
	const lines = frame.split("\n");
	const y = lines.findIndex((line) => line.includes("🔗"));
	const x = stringWidth(lines[y]?.slice(0, lines[y]?.indexOf("🔗")) ?? "");
	return { x, y };
};

it("opens the card on hovering the emoji, and closes it on leaving", async () => {
	const screen = render(<Screen />);
	await screen.idle();

	const frame = () => stripVTControlCharacters(screen.lastFrame() ?? "");
	const { x, y } = emoji(frame());
	expect(frame()).not.toContain("An Example Article");

	screen.stdin.write(hover(x + 1, y));
	await screen.idle();
	expect(frame()).toContain("An Example Article");

	// Onto the card, just below the emoji, it stays.
	screen.stdin.write(hover(x + 1, y + 2));
	await screen.idle();
	expect(frame()).toContain("An Example Article");

	screen.stdin.write(hover(0, frame().split("\n").length - 1));
	await screen.idle();
	expect(frame()).not.toContain("An Example Article");

	screen.unmount();
	screen.cleanup();
});

it("opens the source in the chat's sources from the card's chip", async () => {
	const screen = render(<Screen />);
	await screen.idle();

	const frame = () => stripVTControlCharacters(screen.lastFrame() ?? "");
	const { x, y } = emoji(frame());
	screen.stdin.write(click(x + 1, y));
	await screen.idle();
	const lines = frame().split("\n");
	const chipY = lines.findIndex((line) => line.includes("An Example Article"));
	const chipX = stringWidth(
		lines[chipY]?.slice(0, lines[chipY]?.indexOf("An Example Article")) ?? "",
	);

	screen.stdin.write(click(chipX, chipY));
	await screen.idle();
	expect(useChatSourcesStore.getState().viewedFile).toMatchObject({
		path: "web:https://example.com/article",
		web: sources[0]?.value,
	});
	expect(useLayoutStore.getState().panels.files).toBe(true);
	expect(frame()).not.toContain("An Example Article");

	screen.unmount();
	screen.cleanup();
});

it("opens the card on a click on the emoji, and closes it on one elsewhere", async () => {
	const screen = render(<Screen />);
	await screen.idle();

	const frame = () => stripVTControlCharacters(screen.lastFrame() ?? "");
	const lines = frame().split("\n");
	const y = lines.findIndex((line) => line.includes("🔗"));
	const x = stringWidth(lines[y]?.slice(0, lines[y]?.indexOf("🔗")) ?? "");
	expect(frame()).not.toContain("An Example Article");

	screen.stdin.write(click(x + 1, y));
	await screen.idle();
	expect(frame()).toContain("An Example Article");
	expect(frame()).toContain("https://example.com/article");

	screen.stdin.write(click(0, frame().split("\n").length - 1));
	await screen.idle();
	expect(frame()).not.toContain("An Example Article");

	screen.unmount();
	screen.cleanup();
});
