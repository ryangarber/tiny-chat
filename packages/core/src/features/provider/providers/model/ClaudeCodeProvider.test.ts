import type { TextStreamPart } from "ai";
import { createClaudeCodeProvider } from "#core/features/provider/providers/model/ClaudeCodeProvider.ts";
import { mockConfig, mockUser } from "#core/tests.ts";

const provider = createClaudeCodeProvider(() => {
	throw new Error("No host in these tests.");
});

const transform = (event: Record<string, unknown>) =>
	provider.getEventTransformed?.({
		user: mockUser(),
		config: mockConfig(provider, "haiku"),
		event: event as unknown as TextStreamPart<any>,
	});

describe("ClaudeCodeProvider", () => {
	it("streams a subagent's progress into its call, without `preliminary`", () => {
		// What `ai` hands on: the provider's `preliminary` is gone.
		const events = transform({
			type: "tool-result",
			toolCallId: "ag",
			toolName: "Agent",
			providerExecuted: true,
			input: {},
			output: {
				type: "subagent",
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "Looking" }] },
				],
			},
		});
		expect(events).toMatchObject([{ type: "toolStream", id: "ag" }]);
	});

	it("takes a subagent's real result as its call's result", () => {
		const events = transform({
			type: "tool-result",
			toolCallId: "ag",
			toolName: "Agent",
			providerExecuted: true,
			input: {},
			output: [{ type: "text", text: "Found it" }],
		});
		expect(events).toMatchObject([
			{ type: "data", value: { type: "toolResult", id: "ag", name: "Agent" } },
		]);
	});

	it("reports a background shell with its output, under its own name", () => {
		const events = transform({
			type: "custom",
			kind: "claude-code.task-notification",
			providerMetadata: {
				claudeCode: {
					sessionId: "s1",
					toolCallId: "sh",
					toolName: "Bash",
					status: "completed",
					summary: 'Background command "ls" completed (exit code 0)',
					output: "a.txt\n",
				},
			},
		});
		expect(events).toMatchObject([
			{
				type: "data",
				value: {
					type: "interjection",
					task: { id: "sh", name: "Bash" },
					value: [{ type: "text", value: "a.txt\n" }],
				},
			},
		]);
	});

	it("reports a background subagent with its summary", () => {
		const events = transform({
			type: "custom",
			kind: "claude-code.task-notification",
			providerMetadata: {
				claudeCode: {
					sessionId: "s1",
					toolCallId: "ag",
					status: "completed",
					summary: "The report",
				},
			},
		});
		expect(events).toMatchObject([
			{
				type: "data",
				value: {
					task: { id: "ag", name: "Agent" },
					value: [{ type: "text", value: "The report" }],
				},
			},
		]);
	});
});
