import type {
	ShellCapability,
	TerminalCapability,
} from "#core/core/types/capability.ts";
import { createTerminalTool } from "#core/features/tool/tools/terminal/terminal.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";
import { SurfaceUtils } from "#core/features/tool/utils/SurfaceUtils.ts";

/**
 * Valid only once tmux is found. The user's shell, where there is one, gives
 * sessions their starting directory and judges the commands they run.
 */
export const createTerminalToolset: ToolsetFactory<
	Toolset<{ terminal: TerminalCapability; shell?: ShellCapability }>
> = async (options) => ({
	name: "terminal",
	tools: [await createTerminalTool(options)],
	...options,
	status: await SurfaceUtils.toolsetStatus({
		status: options.status,
		surface: options.capabilities.terminal,
		unavailable: "tmux is unavailable",
	}),
});
