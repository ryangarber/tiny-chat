import type { ActionsCapability } from "#core/core/types/capability.ts";
import { createEditActionsTool } from "#core/features/tool/tools/actions/edit_actions.ts";
import { createSearchActionsTool } from "#core/features/tool/tools/actions/search_actions.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";

export const createActionsToolset: ToolsetFactory<
	Toolset<{
		actions: ActionsCapability;
	}>
> = async (options) => ({
	name: "actions",
	tools: [
		await createSearchActionsTool(options),
		await createEditActionsTool(options),
	],
	...options,
});
