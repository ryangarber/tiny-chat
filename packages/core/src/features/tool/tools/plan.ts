import type { ShellCapability } from "#core/core/types/capability.ts";
import { PlanService } from "#core/features/agent/services/PlanService.ts";
import { createEditPlanTool } from "#core/features/tool/tools/plan/edit_plan.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";

/**
 * The plan's own tool, there for as long as the chat has one: once a message
 * asks for a plan with `/plan`, it is kept up to date through the work that
 * follows. Its instructions travel with that message instead of the system
 * prompt (see `PlanService.getContext`).
 */
export const createPlanToolset: ToolsetFactory<
	Toolset<{ chatShell: ShellCapability }>
> = async (options) => ({
	name: "plan",
	tools: [await createEditPlanTool(options)],
	...options,
	when: (context) =>
		!!context.chat?.id && PlanService.isActive(context.messages),
});
