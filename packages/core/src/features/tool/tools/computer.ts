import type { ComputerCapability } from "#core/core/types/capability.ts";
import { ComputerService } from "#core/features/tool/services/ComputerService.ts";
import { createComputerTool } from "#core/features/tool/tools/computer/computer.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";

/**
 * Valid only once the host can read accessibility trees, so the toolset
 * carries the reason it cannot run (often a permission to grant) rather than
 * failing on use.
 */
export const createComputerToolset: ToolsetFactory<
	Toolset<{ computer: ComputerCapability }>
> = async (options) => {
	let status = options.status;
	if (status.valid) {
		const computer = await ComputerService.status(
			options.capabilities.computer,
		);
		status = computer.available
			? status
			: {
					valid: false,
					error: computer.error ?? "Computer use is unavailable",
				};
	}

	return {
		name: "computer",
		tools: [await createComputerTool(options)],
		...options,
		status,
	};
};
