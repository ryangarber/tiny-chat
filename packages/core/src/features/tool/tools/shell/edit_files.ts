import { z } from "zod";
import type { Capabilities } from "#core/core/types/capability.ts";
import type { DeepPartial } from "#core/core/types/common.ts";
import { FileEditService } from "#core/features/file/services/FileEditService.ts";
import type {
	ToolBlock,
	ToolDisplay,
	ToolStatusPiece,
} from "#core/features/tool/types/display.ts";
import { zFileStep, zFileStepResult } from "#core/features/tool/types/files.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { FileToolUtils } from "#core/features/tool/utils/FileToolUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

export const edit_files = {
	name: "edit_files",
	description:
		"Change files: `write`, `edit`, `rename` and `delete` steps, run in order and stopping at the first that fails. Put every change you can predict into one call, including several edits to one file. The whole call is checked before anything is applied, so a step that could never land fails it with nothing changed. Each edit's result shows the edited lines in context, so there is no need to re-read a file to check an edit landed.",
	input: z.object({
		steps: z.array(zFileStep).min(1),
	}),
	output: z.object({
		steps: z.array(zFileStepResult),
		skipped: z.number().optional(),
	}),
} as const satisfies ToolDefinition;

type PartialStep = DeepPartial<zFileStep> | undefined;

/** Every path the steps touch, a rename's new one included. */
const getPaths = (steps: PartialStep[] = []) => [
	...new Set(
		steps.flatMap((step) => [
			...(step?.path ? [step.path] : []),
			...(step?.action === "rename" && step.to ? [step.to] : []),
		]),
	),
];

/** Steps as blocks: a write as the file, an edit as a diff. */
export const getStepBlocks = (
	steps: PartialStep[] = [],
	path?: string,
): ToolBlock[] =>
	steps.flatMap((step): ToolBlock[] => {
		const target = path ?? step?.path;
		if (step?.action === "write")
			return [ToolDisplayUtils.text({ path: target, content: step.content })];
		if (step?.action === "edit")
			return [
				{
					type: "diff",
					path: target,
					before: step.old_string ?? "",
					after: step.new_string ?? "",
					language: ToolDisplayUtils.language(target),
				},
			];
		if (step?.action === "rename")
			return [
				{
					type: "text",
					value: `Rename ${step.path ?? ""} → ${step.to ?? ""}`,
				},
			];
		if (step?.action === "delete")
			return [{ type: "text", value: `Delete ${step.path ?? ""}` }];
		return [];
	});

/** Errors and skipped steps; what landed is already shown by the input. */
export const getResultBlocks = (
	output: z.infer<typeof edit_files.output>[],
): ToolBlock[] =>
	output.flatMap((result) => [
		...result.steps.flatMap((step): ToolBlock[] =>
			step.error
				? [
						{
							type: "text",
							value: `${step.action} ${step.path}: ${step.error}`,
							tone: "error",
						},
					]
				: [],
		),
		...(result.skipped
			? [
					{
						type: "text" as const,
						value: `Skipped ${result.skipped} later ${result.skipped === 1 ? "step" : "steps"}`,
						tone: "dimmed" as const,
					},
				]
			: []),
	]);

const display: ToolDisplay<typeof edit_files> = {
	status: ({ input }) => {
		const paths = getPaths(input.steps as PartialStep[]);
		if (paths.length > 1)
			return [
				["Editing", "Edited"],
				{ count: ["file", "files"], subject: `${paths.length} files` },
			];
		const status: ToolStatusPiece[] = [
			["Editing", "Edited"],
			{ count: ["file", "files"] },
		];
		if (paths[0]) status.push({ subject: ToolDisplayUtils.name(paths[0]) });
		return status;
	},
	input: ({ input }) => getStepBlocks(input.steps as PartialStep[]),
	output: ({ output }) => getResultBlocks(output),
};

export const createEditFilesTool: ToolFactory<
	Tool<typeof edit_files, Pick<Capabilities, "shell" | "chatShell">>
> = (options) => ({
	...edit_files,
	...options,
	display,
	// Steps read files and write them back, so two calls at once lose one.
	sequential: true,
	validate: async ({ input, context }) => {
		await FileEditService.check({
			steps: input.steps,
			capabilities: options.capabilities,
		});
		const [tmpdir, cwd] = await Promise.all([
			options.capabilities.shell?.tmpdir?.(),
			options.capabilities.shell?.cwd?.(),
		]);
		return {
			approval: getPaths(input.steps).some((path) =>
				FileToolUtils.requiresApproval({
					path,
					context,
					tmpdir,
					cwd,
					shell: options.capabilities.shell,
				}),
			),
		};
	},
	execute: async ({ input, abort }) => [
		{
			type: "json",
			value: await FileEditService.run({
				steps: input.steps,
				capabilities: options.capabilities,
				abort,
			}),
		},
	],
});
