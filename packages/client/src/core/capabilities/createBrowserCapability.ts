import type { Client } from "#client/client.ts";
import { ClientBrowserService } from "#client/features/agent/services/ClientBrowserService.ts";
import type {
	BrowserCapability,
	CapabilityFactory,
} from "#core/core/types/capability.ts";

/** The host's browser, run headed or not as the user last chose. */
export const createBrowserCapability: CapabilityFactory<
	{ client: Client },
	BrowserCapability
> = async ({ client }) => {
	const browser = client.computah?.browser;
	if (!browser) throw new Error("missing client browser");
	return {
		...browser,
		run: (input) =>
			browser.run({
				...input,
				headless: !ClientBrowserService.getSettings({ client }).headed,
			}),
	};
};
