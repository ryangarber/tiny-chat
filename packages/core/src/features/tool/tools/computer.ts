import type { ComputerCapability } from "#core/core/types/capability.ts";
import { createComputerTool } from "#core/features/tool/tools/computer/computer.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";
import { SurfaceUtils } from "#core/features/tool/utils/SurfaceUtils.ts";

/**
 * Valid only once the host can read accessibility trees, which is often a
 * permission to grant.
 */
export const createComputerToolset: ToolsetFactory<
	Toolset<{ computer: ComputerCapability }>
> = async (options) => ({
	name: "computer",
	tools: [await createComputerTool(options)],
	...options,
	status: await SurfaceUtils.toolsetStatus({
		status: options.status,
		surface: options.capabilities.computer,
		unavailable: "Computer use is unavailable",
	}),
});
