/** biome-ignore-all lint/suspicious/noArrayIndexKey: tests */

import { stripVTControlCharacters } from "node:util";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import Box from "#tui/core/components/Box.tsx";
import Content from "#tui/core/components/Content.tsx";
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
