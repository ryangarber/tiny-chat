import { zConfig } from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { TestProvider } from "#core/features/provider/providers/model/TestProvider.ts";
import { ModelTransformService } from "#core/features/provider/services/ModelTransformService.ts";

it("keeps interjections between tool results and subsequent assistant content as user messages", async () => {
	const data: zData = [
		[
			{ id: "before", type: "text", value: "Before" },
			{ id: "tool", type: "toolCall", name: "read", input: {} },
			{
				id: "tool",
				type: "toolResult",
				name: "read",
				output: [{ id: "output", type: "text", value: "Result" }],
			},
			{
				id: "user",
				type: "interjection",
				value: [
					{ id: "text", type: "text", value: "Use this instead" },
					{
						id: "attachment",
						type: "attachment",
						source: "/file",
						label: "file",
						content: {
							type: "web",
							content: "Stored content",
						},
					},
				],
			},
			{ id: "after", type: "text", value: "After" },
		],
	];
	const result = await ModelTransformService.toSdkMessages({
		user: { id: "test", name: "test", settings: {}, isEphemeral: true },
		provider: TestProvider,
		config: zConfig.parse({ provider: "test", model: "test-generate" }),
		messages: [{ author: "MODEL", data }],
	});
	expect(result.map((message) => message.role)).toEqual([
		"assistant",
		"tool",
		"user",
		"assistant",
	]);
	expect(result[2].content).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "text", text: "Use this instead" }),
			expect.objectContaining({ type: "text", text: "Stored content" }),
		]),
	);
	expect(result.at(-1)?.content).toEqual([
		expect.objectContaining({ type: "text", text: "After" }),
	]);
});

it("tells the model of a checkpoint as a note from the user", async () => {
	const data: zData = [
		[
			{ id: "text", type: "text", value: "Halfway" },
			{ id: "cp", type: "abort", reason: "checkpoint", message: "shown" },
		],
	];
	const result = await ModelTransformService.toSdkMessages({
		user: { id: "test", name: "test", settings: {}, isEphemeral: true },
		provider: TestProvider,
		config: zConfig.parse({ provider: "test", model: "test-generate" }),
		messages: [
			{ author: "MODEL", data },
			{
				author: "MODEL",
				data: [[{ id: "stop", type: "abort", reason: "user" }]],
			},
		],
	});
	expect(result.map((message) => message.role)).toEqual(["assistant", "user"]);
	expect(result[1].content).toEqual([
		expect.objectContaining({
			type: "text",
			text: DataUtils.getCheckpointNotice(),
		}),
	]);
});
