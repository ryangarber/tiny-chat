import { z } from "zod";
import type { ActionsCapability } from "#core/core/types/capability.ts";
import { zId } from "#core/core/types/common.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";

export const update_action = {
	name: "update_action",
	description: "Update a scheduled prompt or its schedule.",
	input: z.object({
		id: zId.describe("The ID of the action to update."),
		prompt: z.string().describe("The prompt to send to the assistant."),
		schedule: z
			.string()
			.refine(
				(value) =>
					CommonUtils.parseSchedule({ text: value, timezone: "UTC" }) !== null,
				"Not a valid RRule",
			)
			.describe(
				"The RRule (RFC 5545) schedule to send at. Do not convert - use local time.",
			),
	}),
	output: z.object({
		updated_action_id: zId,
	}),
} as const satisfies ToolDefinition;

const display: ToolDisplay<typeof update_action> = {
	status: ({ input }) => [
		["Updating", "Updated"],
		{ count: ["action", "actions"] },
		{ subject: input.prompt ?? "" },
	],
	input: ({ input }) => [
		{
			type: "record",
			title: input.prompt ?? "",
			details: [CommonUtils.describeSchedule(input.schedule)],
		},
	],
};

export const createUpdateActionTool: ToolFactory<
	Tool<typeof update_action, { actions: ActionsCapability }>
> = (options) => ({
	...update_action,
	...options,
	display,
	execute: async ({ input, context }) => {
		const action = await options.capabilities.actions.updateAction({
			id: input.id,
			data: [
				[{ id: CommonUtils.getRandomId(), type: "text", value: input.prompt }],
			],
			schedule: input.schedule,
			timezone: context.timezone,
		});
		return [{ type: "json", value: { updated_action_id: action.id } }];
	},
});
