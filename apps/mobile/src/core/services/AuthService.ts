import { App } from "@capacitor/app";
import type { RuntimeAuth } from "#gui/core/types/runtime.ts";

/** Whether the launch URL has been handed to a listener yet; it is once. */
let launched = false;

/**
 * The URLs the app is opened with, by its `tinychat` scheme (`Info.plist`,
 * `AndroidManifest.xml`), through `@capacitor/app`.
 */
export const AuthService = {
	onUrl: (listener) => {
		const handle = App.addListener("appUrlOpen", ({ url }) => listener(url));
		if (!launched) {
			launched = true;
			void App.getLaunchUrl().then((launch) => {
				if (launch?.url) listener(launch.url);
			});
		}
		return () => void handle.then((h) => h.remove());
	},
} as const satisfies RuntimeAuth;
