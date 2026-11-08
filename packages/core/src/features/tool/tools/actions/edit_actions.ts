import { z } from "zod";
import type { ActionsCapability } from "#core/core/types/capability.ts";
import { type DeepPartial, zId } from "#core/core/types/common.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	ToolBlock,
	ToolDisplay,
	ToolStatusPiece,
} from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

const zPrompt = z.string().describe("The prompt to send to the assistant.");

const zSchedule = z
	.string()
	.refine(
		(value) =>
			CommonUtils.parseSchedule({ text: value, timezone: "UTC" }) !== null,
		"Not a valid RRule",
	)
	.describe(
		"The RRule (RFC 5545) schedule to send at. Do not convert - use local time.",
	);

const zActionStep = z.discriminatedUnion("action", [
	z
		.object({
			action: z.literal("create"),
			prompt: zPrompt,
			schedule: zSchedule,
		})
		.describe("Schedule a prompt to be sent on a recurring schedule."),
	z
		.object({
			action: z.literal("update"),
			id: zId.describe("The ID of the action to update."),
			prompt: zPrompt,
			schedule: zSchedule,
		})
		.describe("Replace a scheduled action's prompt and schedule."),
	z
		.object({
			action: z.literal("delete"),
			id: zId.describe("The ID of the action to delete."),
			reason: z.string().describe("The reason for deleting the action."),
		})
		.describe("Delete a scheduled action."),
]);
type zActionStep = z.infer<typeof zActionStep>;

const zActionStepResult = z.object({
	action: z.enum(["create", "update", "delete"]),
	id: zId.optional(),
	error: z.string().optional(),
});
type zActionStepResult = z.infer<typeof zActionStepResult>;

export const edit_actions = {
	name: "edit_actions",
	description:
		"Change scheduled actions: `create`, `update` and `delete` steps, run in order and stopping at the first that fails. Put every change into one call. Find the IDs to update or delete with search_actions.",
	input: z.object({
		steps: z.array(zActionStep).min(1),
	}),
	output: z.object({
		steps: z.array(zActionStepResult),
		skipped: z.number().optional(),
	}),
} as const satisfies ToolDefinition;

type PartialStep = DeepPartial<zActionStep> | undefined;

const VERBS = {
	create: ["Scheduling", "Scheduled"],
	update: ["Updating", "Updated"],
	delete: ["Deleting", "Deleted"],
} as const;

const display: ToolDisplay<typeof edit_actions> = {
	status: ({ input }) => {
		const steps = (input.steps ?? []) as PartialStep[];
		const [step] = steps;
		if (steps.length !== 1 || !step?.action)
			return [
				["Editing", "Edited"],
				{
					count: ["action", "actions"],
					...(steps.length > 1 ? { subject: `${steps.length} actions` } : {}),
				},
			];
		const status: ToolStatusPiece[] = [
			[...VERBS[step.action]],
			{ count: ["action", "actions"] },
		];
		const subject =
			step.action === "delete"
				? step.reason
				: "prompt" in step
					? step.prompt
					: undefined;
		if (subject) status.push({ subject });
		return status;
	},
	input: ({ input }) =>
		((input.steps ?? []) as PartialStep[]).flatMap((step): ToolBlock[] =>
			step?.action === "create" || step?.action === "update"
				? [
						{
							type: "record",
							title: step.prompt ?? "",
							details: [
								...(step.action === "update" ? ["Update"] : []),
								CommonUtils.describeSchedule(step.schedule),
							],
						},
					]
				: step?.action === "delete"
					? [{ type: "text", value: `Delete: ${step.reason ?? ""}` }]
					: [],
		),
	output: ({ output }) =>
		ToolDisplayUtils.steps(
			output,
			(step) => `${step.action}${step.id ? ` ${step.id}` : ""}`,
		),
};

export const createEditActionsTool: ToolFactory<
	Tool<typeof edit_actions, { actions: ActionsCapability }>
> = (options) => ({
	...edit_actions,
	...options,
	display,
	sequential: true,
	// An ID that is not there fails the call before anything changes.
	validate: async ({ input }) => {
		const ids = input.steps.flatMap((step) =>
			step.action === "create" ? [] : [step.id],
		);
		if (!ids.length) return undefined;
		const known = new Set(
			(await options.capabilities.actions.getActions()).map(
				(action) => action.id,
			),
		);
		const missing = ids.filter((id) => !known.has(id));
		if (missing.length)
			throw new Error(`No action with ID ${missing.join(", ")}.`);
		return undefined;
	},
	execute: async ({ input, context, abort }) => [
		{
			type: "json",
			value: await ToolUtils.runSteps({
				steps: input.steps,
				abort,
				failed: (step, error): zActionStepResult => ({
					action: step.action,
					...(step.action === "create" ? {} : { id: step.id }),
					error,
				}),
				run: async (step): Promise<zActionStepResult> => {
					const { actions } = options.capabilities;
					if (step.action === "delete") {
						const action = await actions.deleteAction({ id: step.id });
						return { action: step.action, id: action.id };
					}
					const fields = {
						data: [
							[
								{
									id: CommonUtils.getRandomId(),
									type: "text" as const,
									value: step.prompt,
								},
							],
						],
						schedule: step.schedule,
						timezone: context.timezone,
					};
					const action =
						step.action === "create"
							? await actions.createAction(fields)
							: await actions.updateAction({ id: step.id, ...fields });
					return { action: step.action, id: action.id };
				},
			}),
		},
	],
});
