import { createAfmize } from "@afmize/node";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

export const AfmHostService = {
	/**
	 * Apple Foundation Models through `@afmize/node`, in the main process; its
	 * library is bundled beside the main process's own. The provider itself
	 * runs in the webview over these calls.
	 */
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<"afmAvailability" | "afmStream" | "afmCancel"> => {
		// Only macOS on Apple silicon runs it.
		const afmize =
			process.platform === "darwin" && process.arch === "arm64"
				? createAfmize()
				: null;
		/** Running streams, by the key the webview started each under. */
		const streams = new Map<number, AbortController>();

		return {
			afmAvailability: async () =>
				afmize ? await afmize.availability() : null,
			afmStream: async ({ key, request }) => {
				if (!afmize) throw new Error("Apple Foundation Models are unavailable");
				const controller = new AbortController();
				streams.set(key, controller);
				// Answered at once; the events follow as `afmEvent`, `finish` last.
				void (async () => {
					try {
						for await (const event of afmize.stream(request, {
							signal: controller.signal,
						})) {
							send.afmEvent({ key, event });
						}
					} finally {
						streams.delete(key);
					}
				})();
			},
			afmCancel: async ({ key }) => {
				streams.get(key)?.abort();
			},
		};
	},
} as const;
