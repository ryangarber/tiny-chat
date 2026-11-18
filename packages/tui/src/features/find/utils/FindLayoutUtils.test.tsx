import { stripVTControlCharacters } from "node:util";
import { Box, Text } from "better-ink-ui";
import type { DOMElement } from "ink";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { FindUtils } from "#client/features/find/utils/FindUtils.ts";
import { render } from "#tui/core/utils/RenderTestUtils.tsx";
import { FindLayoutUtils } from "#tui/features/find/utils/FindLayoutUtils.ts";

const find = (root: DOMElement, query: string) => {
	const matches = FindUtils.search(FindLayoutUtils.blocks(root), query);
	return FindLayoutUtils.highlights(root, matches, 0);
};

/** What the screen shows at a highlight's cells. */
const under = (
	frame: string,
	{ x, y, text }: { x: number; y: number; text: string },
) =>
	[...(stripVTControlCharacters(frame).split("\n")[y] ?? "")]
		.slice(x, x + text.length)
		.join("");

describe("FindLayoutUtils", () => {
	it("places matches on the cells they are drawn in", async () => {
		const ref = createRef<DOMElement>();
		const screen = render(
			<Box ref={ref} flexDirection="column" width={30} padding={1}>
				<Text>first line</Text>
				<Box paddingLeft={4}>
					<Text>
						const <Text color="blue">use</Text>
						<Text color="green">State</Text>(0)
					</Text>
				</Box>
			</Box>,
		);
		await screen.idle();
		// biome-ignore lint/style/noNonNullAssertion: rendered above
		const highlights = find(ref.current!, "useState(");
		expect(highlights).toEqual([
			{ x: 11, y: 2, text: "useState(", current: true },
		]);
		expect(under(screen.lastFrame() ?? "", highlights[0])).toBe("useState(");
	});

	it("splits a match across the rows wrapping drew it on", async () => {
		const ref = createRef<DOMElement>();
		const screen = render(
			<Box ref={ref} width={12}>
				<Text>alpha beta gamma delta</Text>
			</Box>,
		);
		await screen.idle();
		// biome-ignore lint/style/noNonNullAssertion: rendered above
		const highlights = find(ref.current!, "beta gamma");
		expect(highlights.map(({ text }) => text.trim())).toEqual([
			"beta",
			"gamma",
		]);
		for (const highlight of highlights)
			expect(under(screen.lastFrame() ?? "", highlight).trim()).toBe(
				highlight.text.trim(),
			);
	});

	it("leaves out rows a view has clipped", async () => {
		const ref = createRef<DOMElement>();
		const screen = render(
			<Box ref={ref} flexDirection="column">
				<Box height={1} overflow="hidden" flexDirection="column">
					<Box flexShrink={0}>
						<Text>needle shown</Text>
					</Box>
					<Box flexShrink={0}>
						<Text>needle clipped</Text>
					</Box>
				</Box>
			</Box>,
		);
		await screen.idle();
		// biome-ignore lint/style/noNonNullAssertion: rendered above
		expect(find(ref.current!, "needle").map(({ y }) => y)).toEqual([0]);
	});
});
