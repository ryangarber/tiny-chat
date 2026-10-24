import { z } from "zod";
import type { BrowserCapability } from "#core/core/types/capability.ts";
import {
	zBrowserStep,
	zBrowserStepResult,
} from "#core/features/tool/types/browser.ts";
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

export const browser = {
	name: "browser",
	description: `Drive a real browser on the user's machine. Runs \`steps\` in order against the active tab and stops at the first that fails; the browser and its tabs persist between calls.

Chain whatever you can predict in one call — navigate, wait, click, type, read — rather than one step per call. Read the page as a \`tree\` to get element refs (\`e12\`) to act on; refs last until the page navigates. Before you have read a page, target elements with selectors instead. Set \`screenshot\` when you need to see the result; coordinates (\`x\`/\`y\`) are the screenshot's pixels.`,
	input: z.object({
		steps: z.array(zBrowserStep).min(1),
		screenshot: z
			.boolean()
			.optional()
			.describe("Attach a screenshot of the viewport after the steps run."),
	}),
	output: z.object({
		url: z.string(),
		title: z.string(),
		steps: z.array(zBrowserStepResult),
		skipped: z.number().optional(),
	}),
} as const satisfies ToolDefinition;

/** `navigate example.com, click e3, read` */
const getSummary = (steps: Partial<zBrowserStep>[] = []) =>
	steps
		.map((step) => {
			if (!step?.action) return "";
			const detail =
				step.action === "navigate"
					? (step.url ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "")
					: "ref" in step && step.ref
						? step.ref
						: "selector" in step && step.selector
							? step.selector
							: step.action === "press"
								? step.keys
								: "";
			return [step.action, detail].filter(Boolean).join(" ");
		})
		.filter(Boolean)
		.join(", ");

const display: ToolDisplay<typeof browser> = {
	status: ({ input }) => [
		["Performing", "Performed"],
		{
			count: ["action", "actions"],
			subject: getSummary(input.steps as Partial<zBrowserStep>[]),
		},
		"in a browser",
	],
	input: ({ input }) => [
		{
			type: "code",
			language: "json",
			value: (input.steps ?? []).map((step) => JSON.stringify(step)).join("\n"),
		},
	],
	output: ({ output, files }) => {
		const [result] = output;
		const blocks: ToolBlock[] = [];
		if (result) {
			blocks.push({ type: "json", title: result.url, value: result.steps });
		}
		for (const file of files) {
			const block = ToolDisplayUtils.file({ path: "screenshot", file });
			if (block) blocks.push(block);
		}
		return blocks;
	},
};

export const createBrowserTool: ToolFactory<
	Tool<typeof browser, { browser: BrowserCapability }>
> = (options) => ({
	...browser,
	...options,
	display,
	// There is one browser, and its steps act on whichever tab is active.
	sequential: true,
	execute: async ({ input, abort }) => {
		const { screenshots, ...result } = await options.capabilities.browser.run({
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
