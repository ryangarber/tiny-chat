import {
	type ComputerStep,
	zComputerStep,
	zComputerWindow,
	zStepResult,
} from "computah/schema";
import { z } from "zod";
import type { ComputerCapability } from "#core/core/types/capability.ts";
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

Pick the target with \`window\` (an id like \`w3\`, or an app name or title), or with an \`open\` step. Input goes to the window in the background, through a virtual cursor of its own: nothing is raised and the user's pointer and focus are left alone, so set \`foreground\` on a step only when its input did not land. Chain whatever you can predict in one call — open, read, click, type, wait — rather than one step per call. \`read\` the window to get element refs (\`e12\`) to act on; a ref acts on the element itself, so prefer it over coordinates, and refs carry over until the element goes away. Before you have read a window, target elements with selectors (\`role=button[name="Save"]\`, \`text=Done\`). Set \`screenshot\` (or use a screenshot step) when layout or visual state matters, or when an app exposes little to read; coordinates (\`x\`/\`y\`) are the latest screenshot's pixels.`,
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
		window: zComputerWindow
			.pick({ id: true, app: true, title: true })
			.optional(),
		steps: z.array(zStepResult),
		skipped: z.number().optional(),
		notice: z.string().optional(),
	}),
} as const satisfies ToolDefinition;

/** `open Calculator, click e3, read` */
const getSummary = (steps: Partial<ComputerStep>[] = []) =>
	steps
		.map((step) => {
			if (!step?.action) return "";
			const detail =
				step.action === "open"
					? step.app
					: "ref" in step && step.ref
						? step.ref
						: "selector" in step && step.selector
							? step.selector
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
		["Performing", "Performed"],
		{
			count: ["action", "actions"],
			subject: getSummary(input.steps as Partial<ComputerStep>[]),
		},
		"on this device",
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
	// There is one target window and one cursor.
	sequential: true,
	execute: async ({ input, abort }) => {
		const { screenshots, ...result } = await options.capabilities.computer.run({
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
