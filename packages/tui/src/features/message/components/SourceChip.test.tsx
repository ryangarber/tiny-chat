import { stripVTControlCharacters } from "node:util";
import { Box, Text, useWindowSize } from "ink";
import { beforeEach, expect, it } from "vitest";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChatSourcesStore } from "#client/features/chat/stores/useChatSourcesStore.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import { render } from "#tui/core/utils/RenderTestUtils.tsx";
import SourceChip from "#tui/features/message/components/SourceChip.tsx";

/** An SGR press and release at a cell, counted from 0. */
const click = (x: number, y: number) =>
	`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;

beforeEach(() => {
	useAppStore.setState({ focus: "editor" });
	useLayoutStore.setState({ panels: { chats: false, files: false } });
	useChatSourcesStore.setState({ viewedFile: null });
});

/** Fills the terminal, as the app does, so frame rows are screen rows. */
function Screen() {
	const { rows } = useWindowSize();
	return (
		<Box flexDirection="column" height={rows} width={40}>
			<SourceChip path="memory:abc">
				<Text>Likes tea</Text>
			</SourceChip>
		</Box>
	);
}

it("opens its source in the chat's sources, focused, on a click", async () => {
	const screen = render(<Screen />);
	try {
		await screen.idle();
		const frame = stripVTControlCharacters(screen.lastFrame() ?? "");
		expect(frame).toContain("🧠");
		expect(frame).toContain("Likes tea");

		screen.stdin.write(click(4, 0));
		await screen.idle();
		expect(useChatSourcesStore.getState().viewedFile).toMatchObject({
			path: "memory:abc",
			directory: false,
		});
		expect(useLayoutStore.getState().panels.files).toBe(true);
		expect(useAppStore.getState().focus).toBe("files");
	} finally {
		screen.unmount();
		screen.cleanup();
	}
});
