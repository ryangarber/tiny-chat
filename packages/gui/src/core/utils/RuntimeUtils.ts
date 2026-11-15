import type { ClientRuntime } from "#gui/core/types/runtime.ts";

export const RuntimeUtils = {
	/**
	 * The web's runtime: a browser tab, with nothing native to call. The app
	 * runs on it outside a native host, as on the web or in its dev server.
	 */
	web: {
		platform: "web",
		open: async (url) => void window.open(url, "_blank", "noopener,noreferrer"),
	} satisfies ClientRuntime as ClientRuntime,
} as const;
