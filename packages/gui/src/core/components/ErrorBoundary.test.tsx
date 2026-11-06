import ErrorBoundary from "#gui/core/components/ErrorBoundary.tsx";
import { act, render } from "#gui/tests.ts";

/** Fails to draw for as long as `fail.current` holds. */
function Flaky({ fail, text }: { fail: { current: boolean }; text: string }) {
	if (fail.current) throw new Error("boom");
	return <span>{text}</span>;
}

describe("ErrorBoundary", () => {
	it("leaves a note in place of what failed, and the rest drawn", async () => {
		const fail = { current: true };
		const screen = await render(
			<div>
				<span>sibling</span>
				<ErrorBoundary label="this block">
					<Flaky fail={fail} text="recovered" />
				</ErrorBoundary>
			</div>,
		);

		await expect
			.element(screen.getByText("Couldn’t draw this block: boom"))
			.toBeInTheDocument();
		await expect.element(screen.getByText("sibling")).toBeInTheDocument();

		fail.current = false;
		await act(async () => {
			await screen.getByRole("button", { name: "Try again" }).click();
		});
		await expect.element(screen.getByText("recovered")).toBeInTheDocument();
	});

	it("draws again once its reset key changes", async () => {
		const fail = { current: true };
		const screen = await render(
			<ErrorBoundary label="this markdown" resetKey="a">
				<Flaky fail={fail} text="first" />
			</ErrorBoundary>,
		);
		await expect
			.element(screen.getByText("Couldn’t draw this markdown: boom"))
			.toBeInTheDocument();

		fail.current = false;
		await screen.rerender(
			<ErrorBoundary label="this markdown" resetKey="b">
				<Flaky fail={fail} text="second" />
			</ErrorBoundary>,
		);
		await expect.element(screen.getByText("second")).toBeInTheDocument();
	});
});
