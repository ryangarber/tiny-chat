import type { BrowserCapability } from "#core/core/types/capability.ts";
import { createBrowserTool } from "#core/features/tool/tools/browser/browser.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";
import { SurfaceUtils } from "#core/features/tool/utils/SurfaceUtils.ts";

/** Valid only once the host has found Playwright and a browser to launch. */
export const createBrowserToolset: ToolsetFactory<
	Toolset<{ browser: BrowserCapability }>
> = async (options) => ({
	name: "browser",
	tools: [await createBrowserTool(options)],
	...options,
	status: await SurfaceUtils.toolsetStatus({
		status: options.status,
		surface: options.capabilities.browser,
		unavailable: "No browser available",
	}),
});
