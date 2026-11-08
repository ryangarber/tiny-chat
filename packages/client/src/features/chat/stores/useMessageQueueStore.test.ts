import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";

const text = (value: string) => [[{ type: "text" as const, id: value, value }]];
describe("useMessageQueueStore", () => {
	beforeEach(() =>
		useMessageQueueStore.setState({ queues: {}, active: {}, paused: {} }),
	);
	it("drains messages once in order and isolates chats", () => {
		const queue = useMessageQueueStore.getState();
		const data = text("first");
		queue.enqueue("a", data);
		data[0][0].value = "changed";
		queue.enqueue("a", text("second"));
		queue.enqueue("b", text("other"));
		expect(queue.drain("a").map((part) => part.value)).toEqual([
			text("first")[0],
			text("second")[0],
		]);
		expect(queue.drain("a")).toEqual([]);
		expect(queue.drain("b")).toHaveLength(1);
	});
	it("keeps queued messages across approval pauses but clears on completion or failure", () => {
		const queue = useMessageQueueStore.getState();
		const pending = [
			[
				{
					type: "toolCall" as const,
					id: "tool",
					name: "shell_exec",
					input: {},
				},
			],
		];
		queue.enqueue("a", text("follow-up"));
		queue.setActive("a", true);
		queue.finish("a", pending);
		expect(useMessageQueueStore.getState().queues.a).toHaveLength(1);
		expect(useMessageQueueStore.getState().paused.a).toBe(true);
		queue.finish("a", text("done"));
		expect(useMessageQueueStore.getState().queues.a).toBeUndefined();
		expect(useMessageQueueStore.getState().active.a).toBe(false);
		expect(useMessageQueueStore.getState().paused.a).toBe(false);
		queue.enqueue("a", text("follow-up"));
		queue.finish("a", pending, true);
		expect(useMessageQueueStore.getState().queues.a).toBeUndefined();
	});
	it("does not wait on the provider's own calls that never reported back", () => {
		const queue = useMessageQueueStore.getState();
		const call = {
			type: "toolCall" as const,
			id: "tool",
			name: "shell",
			input: {},
			providerExecuted: true,
		};
		queue.setActive("a", true);
		queue.finish("a", [[call]]);
		expect(useMessageQueueStore.getState().active.a).toBe(false);
		queue.setActive("a", true);
		queue.finish("a", [[{ ...call, validation: { approval: true } }]]);
		expect(useMessageQueueStore.getState().active.a).toBe(true);
		expect(useMessageQueueStore.getState().paused.a).toBe(true);
	});
	it("removes only the selected queued message", () => {
		const queue = useMessageQueueStore.getState();
		queue.enqueue("a", text("first"));
		queue.enqueue("a", text("second"));
		queue.remove("a", useMessageQueueStore.getState().queues.a[0].id);
		expect(queue.drain("a")[0].value).toEqual(text("second")[0]);
	});
});
