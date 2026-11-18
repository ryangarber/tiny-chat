import { Text } from "better-ink-ui";
import Quote from "#tui/features/part/components/Quote.tsx";
import render from "#tui/tests.ts";

describe("Quote", () => {
	it("renders model names to quotes", async () => {
		const screen = await render(
			<Quote model="gpt-6">
				<Text>Quote from GPT 6.</Text>
			</Quote>,
		);
		expect(screen.lastFrame()?.includes("gpt-6")).toBe(true);
		screen.unmount();
		screen.cleanup();
	});
});
