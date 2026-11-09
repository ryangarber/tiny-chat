import { z } from "zod";
import type { ShellCapability } from "#core/core/types/capability.ts";
import { PlanService } from "#core/features/agent/services/PlanService.ts";
import { FileEditService } from "#core/features/file/services/FileEditService.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { getStepBlocks } from "#core/features/tool/tools/shell/edit_files.ts";
import {
	getReadWindow,
	zFileRead,
} from "#core/features/tool/tools/shell/read_files.ts";
import type {
	ToolBlock,
	ToolDisplay,
} from "#core/features/tool/types/display.ts";
import {
	zFileEditStep,
	zFileStepResult,
	zFileWriteStep,
} from "#core/features/tool/types/files.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

const zPlanReadStep = zFileRead
	.pick({ offset: true, limit: true, line_numbers: true })
	.extend({ action: z.literal("read") })
	.describe("Read the plan back, whole or as a window of its lines.");

const zPlanStepResult = zFileStepResult.extend({
	action: z.enum(["read", "write", "edit"]),
	/** What a read returned. */
	content: z.string().optional(),
	notice: z.string().optional(),
});

export const plan = {
	name: "plan",
	description:
		"Read, write or revise the chat's plan, in Markdown: `read` steps return it, `write` steps replace all of it, `edit` steps replace a snippet. Run in order, stopping at the first that fails. Each edit's result shows the edited lines in context.",
	input: z.object({
		steps: z
			.array(
				z.discriminatedUnion("action", [
					zPlanReadStep,
					zFileWriteStep.omit({ path: true }),
					zFileEditStep.omit({ path: true }),
				]),
			)
			.min(1),
	}),
	output: z.object({
		steps: z.array(zPlanStepResult),
		skipped: z.number().optional(),
	}),
} as const satisfies ToolDefinition;

type Input = z.infer<typeof plan.input>;
type Step = Input["steps"][number];
type StepResult = z.infer<typeof zPlanStepResult>;

const getChatId = (context: { chat?: { id?: string | null } | null }) => {
	const id = context.chat?.id;
	if (!id) throw new Error("This chat has no plan, as it has not been saved.");
	return id;
};

const getChanges = (input: Input, path: string) =>
	input.steps.flatMap((step) =>
		step.action === "read" ? [] : [{ ...step, path }],
	);

/** Whether a call changes the plan rather than only reading it. */
export const isPlanChange = (output: z.infer<typeof plan.output>[]) =>
	output.some((result) =>
		result.steps.some((step) => step.action !== "read" && !step.error),
	);

const display: ToolDisplay<typeof plan> = {
	status: ({ input }) => {
		const steps = input.steps ?? [];
		if (steps.length && steps.every((step) => step?.action === "read"))
			return ToolDisplayUtils.status.plan(["Reading", "Read"]);
		return ToolDisplayUtils.status.plan(
			steps.some((step) => step?.action === "write")
				? ["Writing", "Wrote"]
				: ["Updating", "Updated"],
		);
	},
	input: ({ input }) =>
		getStepBlocks(
			input.steps?.filter((step) => step?.action !== "read") as Parameters<
				typeof getStepBlocks
			>[0],
			"plan.md",
		),
	output: ({ output }) => [
		...output.flatMap((result) =>
			result.steps.flatMap((step): ToolBlock[] =>
				step.action === "read" && !step.error
					? [ToolDisplayUtils.text({ path: "plan.md", content: step.content })]
					: [],
			),
		),
		...ToolDisplayUtils.steps(output, (step) => `${step.action} plan.md`),
	],
};

export const createPlanTool: ToolFactory<
	Tool<typeof plan, { chatShell: ShellCapability }>
> = (options) => {
	const run = async (step: Step, path: string): Promise<StepResult> => {
		if (step.action !== "read")
			return (await FileEditService.runStep({
				step: { ...step, path },
				capabilities: options.capabilities,
			})) as StepResult;
		const file = await options.capabilities.chatShell.readFile({ path });
		const window = getReadWindow({
			read: step,
			path: file.path,
			content: FileUtils.getTextFromBytes(file) ?? "",
		});
		return {
			action: "read",
			path: file.path,
			content: window.text,
			...(window.notice ? { notice: window.notice } : {}),
		};
	};

	return {
		...plan,
		...options,
		display,
		sequential: true,
		validate: async ({ input, context }) => {
			await FileEditService.check({
				steps: getChanges(input, PlanService.path(getChatId(context))),
				capabilities: options.capabilities,
			});
			// The plan is in the chat's own directory, which is always writable.
			return { approval: false };
		},
		execute: async ({ input, context, abort }) => {
			const path = PlanService.path(getChatId(context));
			return [
				{
					type: "json",
					value: await ToolUtils.runSteps({
						steps: input.steps,
						run: (step) => run(step, path),
						failed: (step, error) => ({ action: step.action, path, error }),
						abort,
					}),
				},
			];
		},
	};
};
