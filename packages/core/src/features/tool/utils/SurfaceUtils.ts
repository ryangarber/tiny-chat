import type { SurfaceCapability } from "#core/core/types/capability.ts";
import type { ToolsetStatus } from "#core/features/tool/types/tool.ts";

export const SurfaceUtils = {
	/**
	 * A computah surface's toolset is valid only once the surface can run, so
	 * it carries the reason it cannot (something to install, a permission to
	 * grant) rather than failing on use.
	 */
	toolsetStatus: async ({
		status,
		surface,
		unavailable,
	}: {
		status: ToolsetStatus;
		surface: SurfaceCapability<{ available: boolean; error?: string }>;
		/** Said when the surface is unavailable without saying why. */
		unavailable: string;
	}): Promise<ToolsetStatus> => {
		if (!status.valid) return status;
		const found = await surface.status().catch((error: unknown) => ({
			available: false,
			error: error instanceof Error ? error.message : String(error),
		}));
		return found.available
			? status
			: { valid: false, error: found.error ?? unavailable };
	},
} as const;
