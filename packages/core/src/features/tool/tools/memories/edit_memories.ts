import { z } from "zod";
import { Enum } from "#core/core/services/PostgresService.ts";
import type { MemoriesCapability } from "#core/core/types/capability.ts";
import { type DeepPartial, zId } from "#core/core/types/common.ts";
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

const zFact = {
	fact: z.string().describe("The fact about the user."),
	category: z
		.enum(Enum.MemoryCategory.values)
		.describe("The category the fact belongs to."),
	stability: z
		.enum(Enum.MemoryStability.values)
		.describe("How long the fact is expected to remain true."),
	evidence: z
		.union([z.string(), z.array(z.string())])
		.describe("Evidence to support the fact."),
	confidence: z
		.number()
		.min(0)
		.max(1)
		.describe("Confidence that the fact is accurate and worth remembering."),
};

const zMemoryStep = z.discriminatedUnion("action", [
	z
		.object({ action: z.literal("create"), ...zFact })
		.describe("Remember a new fact about the user."),
	z
		.object({
			action: z.literal("update"),
			id: zId.describe("The ID of the memory to update."),
			...zFact,
		})
		.describe("Replace a remembered fact."),
	z
		.object({
			action: z.literal("delete"),
			id: zId.describe("The ID of the memory to delete."),
			reason: z
				.string()
				.describe(
					"The new fact that warranted deleting the old fact about the user.",
				),
		})
		.describe("Forget a fact about the user."),
]);
type zMemoryStep = z.infer<typeof zMemoryStep>;

const zMemoryStepResult = z.object({
	action: z.enum(["create", "update", "delete"]),
	id: zId.optional(),
	error: z.string().optional(),
});
type zMemoryStepResult = z.infer<typeof zMemoryStepResult>;

export const edit_memories = {
	name: "edit_memories",
	description:
		"Change what you remember about the user: `create`, `update` and `delete` steps, run in order and stopping at the first that fails. Put every change into one call, such as merging duplicates by updating one and deleting the rest. Find the IDs to update or delete with search_memories.",
	input: z.object({
		steps: z.array(zMemoryStep).min(1),
	}),
	output: z.object({
		steps: z.array(zMemoryStepResult),
		skipped: z.number().optional(),
	}),
} as const satisfies ToolDefinition;

type PartialStep = DeepPartial<zMemoryStep> | undefined;

const VERBS = {
	create: ["Remembering", "Remembered"],
	update: ["Updating", "Updated"],
	delete: ["Deleting", "Deleted"],
} as const;

const display: ToolDisplay<typeof edit_memories> = {
	status: ({ input }) => {
		const steps = (input.steps ?? []) as PartialStep[];
		const [step] = steps;
		if (steps.length !== 1 || !step?.action)
			return [
				["Editing", "Edited"],
				{
					count: ["memory", "memories"],
					...(steps.length > 1 ? { subject: `${steps.length} memories` } : {}),
				},
			];
		if (step.action === "create")
			return [
				[...VERBS.create],
				{ count: ["fact", "facts"], subject: step.fact ?? "" },
			];
		const status: ToolStatusPiece[] = [
			[...VERBS[step.action]],
			{ count: ["memory", "memories"] },
		];
		const subject =
			step.action === "delete"
				? step.reason
				: "fact" in step
					? step.fact
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
							title: step.fact ?? "",
							details: [
								...(step.action === "update" ? ["Update"] : []),
								...[step.category, step.stability].filter(
									(detail): detail is NonNullable<typeof detail> => !!detail,
								),
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

export const createEditMemoriesTool: ToolFactory<
	Tool<typeof edit_memories, { memories: MemoriesCapability }>
> = (options) => ({
	...edit_memories,
	...options,
	display,
	sequential: true,
	execute: async ({ input, abort }) => [
		{
			type: "json",
			value: await ToolUtils.runSteps({
				steps: input.steps,
				abort,
				failed: (step, error): zMemoryStepResult => ({
					action: step.action,
					...(step.action === "create" ? {} : { id: step.id }),
					error,
				}),
				run: async (step): Promise<zMemoryStepResult> => {
					const { memories } = options.capabilities;
					if (step.action === "delete") {
						const memory = await memories.deleteMemory({ id: step.id });
						return { action: step.action, id: memory.id };
					}
					const fields = {
						fact: step.fact,
						category: step.category,
						stability: step.stability,
						evidence: Array.isArray(step.evidence)
							? step.evidence
							: [step.evidence],
						confidence: step.confidence,
					};
					const memory =
						step.action === "create"
							? await memories.createMemory(fields)
							: await memories.updateMemory({ id: step.id, ...fields });
					return { action: step.action, id: memory.id };
				},
			}),
		},
	],
});
