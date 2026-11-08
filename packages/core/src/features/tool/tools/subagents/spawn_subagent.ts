import { z } from "zod";
import type { SubagentsCapability } from "#core/core/types/capability.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import { zAbortPart, zData } from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

const BACKGROUND_DESCRIPTION =
	"Set to TRUE to run the subagent in the background and carry on working meanwhile. Its result is sent to you when it finishes, and your turn does not end until then.";

const SUBAGENT_INSTRUCTIONS = `## Subagent

You are an autonomous subagent, running in a non-interactive context. The user message is a task from another agent in this chat, not from the user, and your final reply is returned to that agent. Nobody can answer questions, so make reasonable assumptions and say what they were.
You share that agent's context above: its project, folders, tools and skills. When the task refers to "the code", "the repo" or "the project" without saying where, it means the folders above, starting with the primary one.
Read-only tools and bash commands will work, but those that require approval (such as sed) will not. Use the tools available to you to complete your task to the best of your abilities.`;

export const spawn_subagent = {
	name: "spawn_subagent",
	description:
		"Run a subagent to perform a task. Subagents called together run at the same time.",
	input: z.object({
		task: z
			.string()
			.describe(
				"A 1-2 sentence describing what the agent will do to the user.",
			),
		prompt: z
			.string()
			.describe(
				"Detailed instructions for the agent, including the task to perform and the results to provide.",
			),
		background: z.boolean().optional().describe(BACKGROUND_DESCRIPTION),
	}),
	output: z.object({
		response: z.string(),
		errors: z.array(
			zAbortPart.transform((part) => ({
				reason: part.reason,
				message: part.message,
				details: part.details,
			})),
		),
	}),
	stream: zData,
} as const satisfies ToolDefinition;

const display: ToolDisplay<typeof spawn_subagent> = {
	status: ({ input }) => ToolDisplayUtils.status.subagent(input.task),
	input: ({ input }) => [ToolDisplayUtils.prompt(input.prompt)],
	// The live conversation while it runs, settling into the answer it gave.
	output: ({ state, stream, output }) => {
		if (state === "running")
			return ToolDisplayUtils.conversation({ state, stream });
		return output.map((result) => ({
			type: "messages",
			data: [[{ id: "response", type: "text", value: result.response }]],
		}));
	},
};

export const createSpawnSubagentTool: ToolFactory<
	Tool<typeof spawn_subagent, { subagents: SubagentsCapability }>
> = (options) => ({
	...spawn_subagent,
	...options,
	display,
	background: true,
	execute: async ({ id, input, stream, abort, context }) => {
		const { subagentConfig } = SettingsUtils.of(
			context.user,
			context.chat?.project,
		);
		if (!subagentConfig) throw new Error("missing subagent config");

		// The reply being written, which holds this call.
		const reply = context.messages.at(-1);
		const data = await options.capabilities.subagents.runSubagent({
			part: id && reply?.id ? { id, message: reply.id } : undefined,
			context: {
				user: context.user,
				chat: context.chat,
				messages: [
					{
						id: null,
						author: "USER",
						config: subagentConfig,
						data: [
							[
								{
									id: CommonUtils.getRandomId(),
									type: "text",
									value: input.prompt,
								},
							],
						],
						createdAt: Temporal.Now.plainDateTimeISO("UTC"),
					},
					{
						id: null,
						author: "MODEL",
						config: subagentConfig,
						data: [],
						createdAt: Temporal.Now.plainDateTimeISO("UTC"),
					},
				],
				timezone: context.timezone,
				interactive: false,
			},
			instructions: SUBAGENT_INSTRUCTIONS,
			onData: (data) => stream?.({ mode: "replace", data }),
			abort,
		});
		console.log("[spawn_subagent] response from agent:", data);
		const error = data.flat().find((part) => part.type === "abort");
		if (error?.reason === "error") {
			console.error("Subagent error:", error);
			throw new Error(
				`Failed to run subagent due to ${error.reason}: ${CommonUtils.formatError(error)}`,
			);
		}
		return [
			{
				type: "json",
				value: {
					response: DataUtils.getText({ data }),
					errors: error
						? [
								{
									reason: error.reason,
									message: error.message,
									details: error.details,
								},
							]
						: [],
				},
			},
		];
	},
});
