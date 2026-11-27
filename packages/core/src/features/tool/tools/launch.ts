import type { LaunchCapability } from "#core/core/types/capability.ts";
import { createLaunchTool } from "#core/features/tool/tools/launch/launch.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";

/**
 * There whenever the chat's project has launches and the host can run them:
 * the user set them up, so they are not something to pick per message.
 */
export const createLaunchToolset: ToolsetFactory<
	Toolset<{ launch: LaunchCapability }>
> = async (options) => ({
	name: "launch",
	tools: [await createLaunchTool(options)],
	...options,
	when: (context) => LaunchUtils.of(context.chat?.project).length > 0,
});
