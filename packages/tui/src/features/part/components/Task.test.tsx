import { stripVTControlCharacters } from "node:util";
import chalk from "chalk";
import Task from "#tui/features/part/components/Task.tsx";
import { TaskUtils } from "#tui/features/part/utils/TaskUtils.ts";
import render from "#tui/tests.ts";

describe("Task.Status", () => {
	it("advances the shimmer with unchanged text and stops when settled", async () => {
		const colorLevel = chalk.level;
		chalk.level = 3;
		const shimmer = vi.spyOn(TaskUtils, "shimmer");
		const parts = [{ text: "Waiting for a tool" }];
		const status = (value: "pending" | "success" | "error") => (
			<Task>
				<Task.Status status={value} parts={parts} />
			</Task>
		);
		const screen = await render(status("pending"));
		try {
			await vi.waitFor(() => expect(shimmer).toHaveBeenCalled());
			const firstTime = shimmer.mock.calls.at(-1)?.[0].time;
			const firstFrame = screen.lastFrame();
			await vi.waitFor(() => {
				expect(shimmer.mock.calls.at(-1)?.[0].time).toBeGreaterThan(
					firstTime ?? 0,
				);
			});
			await vi.waitFor(() => expect(screen.lastFrame()).not.toBe(firstFrame));
			expect(stripVTControlCharacters(screen.lastFrame() ?? "")).toContain(
				parts[0].text,
			);

			for (const value of ["success", "error"] as const) {
				screen.rerender(status(value));
				await screen.idle();
				shimmer.mockClear();
				const frames = screen.frames.length;
				await new Promise((resolve) => setTimeout(resolve, 180));
				expect(shimmer).not.toHaveBeenCalled();
				expect(screen.frames).toHaveLength(frames);
			}
		} finally {
			screen.unmount();
			screen.cleanup();
			shimmer.mockRestore();
			chalk.level = colorLevel;
		}
	});
});
