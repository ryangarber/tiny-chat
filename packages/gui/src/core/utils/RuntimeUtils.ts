import type { ClientRuntime } from "#gui/core/types/runtime.ts";

export const RuntimeUtils = {
	/**
	 * The web's runtime: a browser tab, with nothing native to call. A host
	 * app's runtime falls back on it outside the host, as when its dev server
	 * is opened in a browser.
	 */
	web: {
		platform: "web",
		open: async (url) => void window.open(url, "_blank", "noopener,noreferrer"),
	} satisfies ClientRuntime as ClientRuntime,
} as const;
