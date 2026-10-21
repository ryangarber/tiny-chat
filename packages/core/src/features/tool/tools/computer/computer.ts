import { z } from "zod";
import type { ComputerCapability } from "#core/core/types/capability.ts";
import { ComputerService } from "#core/features/tool/services/ComputerService.ts";
import {
	zComputerStep,
	zComputerStepResult,
} from "#core/features/tool/types/computer.ts";
import type {
	ToolBlock,
	ToolDisplay,
} from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

export const computer = {
	name: "computer",
	description: `Use apps on the user's computer through their accessibility trees. Runs \`steps\` in order against the target window and stops at the first that fails; the target carries over between calls.

Pick the target with \`window\` (an id like \`w3\`, or an app name or title), or with an \`open\` step. Chain whatever you can predict in one call — open, read, click, type, wait — rather than one step per call. \`read\` the window to get element refs (\`e12\`) to act on; a ref acts on the element itself, so prefer it over coordinates, and refs carry over until the element goes away. Set \`screenshot\` (or use a screenshot step) when layout or visual state matters, or when an app exposes little to read; coordinates (\`x\`/\`y\`) are the latest screenshot's pixels.`,
	input: z.object({
		window: z
			.string()
			.optional()
			.describe(
				"The window to act on: an id from a windows step (`w3`), or an app name or title. Defaults to the last one used.",
			),
		steps: z.array(zComputerStep).min(1),
		screenshot: z
			.boolean()
			.optional()
			.describe(
				"Attach a screenshot of the target window after the steps run.",
			),
	}),
	output: z.object({
		window: z
			.object({
				id: z.string(),
				app: z.string(),
				title: z.string().optional(),
			})
			.optional(),
		steps: z.array(zComputerStepResult),
		skipped: z.number().optional(),
	}),
} as const satisfies ToolDefinition;

/** `open Calculator, click e3, read` */
const getSummary = (steps: Partial<zComputerStep>[] = []) =>
	steps
		.map((step) => {
			if (!step?.action) return "";
			const detail =
				step.action === "open"
					? step.app
					: "ref" in step && step.ref
						? step.ref
						: step.action === "press"
							? step.keys
							: step.action === "window"
								? step.op
								: "";
			return [step.action, detail].filter(Boolean).join(" ");
		})
		.filter(Boolean)
		.join(", ");

const display: ToolDisplay<typeof computer> = {
	status: ({ input }) => [
		["Using the computer", "Used the computer"],
		{
			count: ["step", "steps"],
			subject: getSummary(input.steps as Partial<zComputerStep>[]),
		},
	],
	input: ({ input }) => [
		{
			type: "code",
			language: "json",
			value: [
				...(input.window ? [JSON.stringify({ window: input.window })] : []),
				...(input.steps ?? []).map((step) => JSON.stringify(step)),
			].join("\n"),
		},
	],
	output: ({ output, files }) => {
		const [result] = output;
		const blocks: ToolBlock[] = [];
		if (result) {
			const window = result.window;
			blocks.push({
				type: "json",
				title: window
					? [window.app, window.title].filter(Boolean).join(" — ")
					: undefined,
				value: result.steps,
			});
		}
		for (const file of files) {
			const block = ToolDisplayUtils.file({ path: "screenshot", file });
			if (block) blocks.push(block);
		}
		return blocks;
	},
};

export const createComputerTool: ToolFactory<
	Tool<typeof computer, { computer: ComputerCapability }>
> = (options) => ({
	...computer,
	...options,
	display,
	// There is one screen, pointer and keyboard, and one target window.
	sequential: true,
	execute: async ({ input, abort }) => {
		const { screenshots, ...result } = await ComputerService.run({
			capability: options.capabilities.computer,
			window: input.window,
			steps: input.steps,
			screenshot: input.screenshot,
			abort,
		});

		return [
			{ type: "json", value: result },
			...screenshots.map((screenshot, index) => ({
				type: "file" as const,
				name: `screenshot-${index + 1}.${screenshot.mime.split("/")[1]}`,
				mime: screenshot.mime,
				data: screenshot.data,
			})),
		];
	},
});
