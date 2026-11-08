import { z } from "zod";
import type { WebCapability } from "#core/core/types/capability.ts";
import { zWebContext } from "#core/features/provider/types/web.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

export const view_web = {
	name: "view_web",
	description: "View the contents of any URL.",
	input: z.object({
		url: z.string(),
	}),
	output: zWebContext,
} as const satisfies ToolDefinition;

const display: ToolDisplay<typeof view_web> = {
	status: ({ input }) => ToolDisplayUtils.status.viewWeb(input.url),
	output: ({ output }) => output.map((source) => ({ type: "web", source })),
};

export const createViewWebTool: ToolFactory<
	Tool<typeof view_web, { web: WebCapability }>
> = (options) => ({
	...view_web,
	...options,
	display,
	execute: async ({ input }) => {
		return [
			{
				type: "json",
				value: await options.capabilities.web.view({ url: input.url }),
			},
		];
	},
});
