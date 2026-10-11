import { afterEach, expect, it, vi } from "vitest";
import Tasks from "#gui/core/components/Tasks.tsx";
import { useUpdateStore } from "#gui/features/update/stores/useUpdateStore.ts";
import { act, render } from "#gui/tests.ts";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	useUpdateStore.setState({ tasks: {} });
});

it.each([false, true])(
	"removes a task at 100% (progress animation finished: %s)",
	async (finishProgress) => {
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.set(++nextFrame, callback);
			return nextFrame;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			frames.delete(id);
		});

		await render(<Tasks />);
		await act(async () => {
			useUpdateStore.getState().addTask("update", "Downloading update");
		});
		await act(async () => {
			void useUpdateStore.getState().updateTask("update", 100);
		});
		expect(frames.size).toBeGreaterThan(0);

		if (finishProgress) {
			await act(async () => {
				const callbacks = [...frames.values()];
				frames.clear();
				for (const callback of callbacks) callback(performance.now() + 1000);
			});
			expect(useUpdateStore.getState().tasks.update).toBeDefined();
		}

		let removed = false;
		await act(async () => {
			void useUpdateStore
				.getState()
				.removeTask("update")
				.then(() => {
					removed = true;
				});
		});
		await act(async () => {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const callback of callbacks) callback(performance.now() + 1000);
		});

		await expect.poll(() => removed, { timeout: 2500 }).toBe(true);
		expect(useUpdateStore.getState().tasks.update).toBeUndefined();
	},
);
