import { z } from "zod";
import type { ShellCapability } from "#core/core/types/capability.ts";
import { PlanService } from "#core/features/agent/services/PlanService.ts";
import { FileEditService } from "#core/features/file/services/FileEditService.ts";
import {
	edit_files,
	getResultBlocks,
	getStepBlocks,
} from "#core/features/tool/tools/shell/edit_files.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import {
	zFileEditStep,
	type zFileStep,
	zFileWriteStep,
} from "#core/features/tool/types/files.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";

export const edit_plan = {
	name: "edit_plan",
	description:
		"Write or revise the chat's plan, in Markdown: `write` steps replace all of it, `edit` steps replace a snippet. Run in order, stopping at the first that fails. Each edit's result shows the edited lines in context.",
	input: z.object({
		steps: z
			.array(
				z.discriminatedUnion("action", [
					zFileWriteStep.omit({ path: true }),
					zFileEditStep.omit({ path: true }),
				]),
			)
			.min(1),
	}),
	output: edit_files.output,
} as const satisfies ToolDefinition;

type Input = z.infer<typeof edit_plan.input>;

const getChatId = (context: { chat?: { id?: string | null } | null }) => {
	const id = context.chat?.id;
	if (!id) throw new Error("This chat has no plan, as it has not been saved.");
	return id;
};

const toSteps = (input: Input, path: string): zFileStep[] =>
	input.steps.map((step) => ({ ...step, path }));

const display: ToolDisplay<typeof edit_plan> = {
	status: ({ input }) => [
		input.steps?.some((step) => step?.action === "write")
			? ["Writing", "Wrote"]
			: ["Updating", "Updated"],
		{ count: ["plan", "plans"] },
	],
	input: ({ input }) => getStepBlocks(input.steps, "plan.md"),
	output: ({ output }) => getResultBlocks(output),
};

export const createEditPlanTool: ToolFactory<
	Tool<typeof edit_plan, { chatShell: ShellCapability }>
> = (options) => ({
	...edit_plan,
	...options,
	display,
	sequential: true,
	validate: async ({ input, context }) => {
		await FileEditService.check({
			steps: toSteps(input, PlanService.path(getChatId(context))),
			capabilities: options.capabilities,
		});
		// The plan is in the chat's own directory, which is always writable.
		return { approval: false };
	},
	execute: async ({ input, context, abort }) => [
		{
			type: "json",
			value: await FileEditService.run({
				steps: toSteps(input, PlanService.path(getChatId(context))),
				capabilities: options.capabilities,
				abort,
			}),
		},
	],
});
