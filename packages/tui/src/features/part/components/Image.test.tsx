import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { Box, useWindowSize } from "ink";
import { expect, it, vi } from "vitest";
import { OpenerService } from "#tui/core/services/OpenerService.ts";
import Image from "#tui/features/part/components/Image.tsx";
import render from "#tui/tests.ts";

/** A 1×1 PNG. */
const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** An SGR press and release at a cell, counted from 0. */
const click = (x: number, y: number) =>
	`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;

/** Fills the terminal, as the app does, so frame rows are screen rows. */
function Screen() {
	const { rows } = useWindowSize();
	return (
		<Box flexDirection="column" height={rows} width={40}>
			<Image src={`data:image/png;base64,${PNG}`} alt="shot" />
		</Box>
	);
}

it("stands a data URL as a link to a temp file that a click opens", async () => {
	const open = vi.spyOn(OpenerService, "open").mockResolvedValue(true);
	const screen = await render(<Screen />);
	try {
		await screen.idle();
		const frame = stripVTControlCharacters(screen.lastFrame() ?? "");
		expect(frame).toContain("[image: shot]");

		// The link takes clicks once its temp file is written.
		await vi.waitFor(async () => {
			screen.stdin.write(click(3, 0));
			await screen.idle();
			expect(open).toHaveBeenCalled();
		});
		const url = open.mock.calls[0]?.[0] as string;
		const path = fileURLToPath(url);
		expect(path.endsWith(".png")).toBe(true);
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path).toString("base64")).toBe(PNG);
	} finally {
		open.mockRestore();
		screen.unmount();
		screen.cleanup();
	}
});
