import { Capacitor } from "@capacitor/core";
import type { ClientRuntime } from "#gui/core/types/runtime.ts";
import { RuntimeUtils } from "#gui/core/utils/RuntimeUtils.ts";
import { AuthService } from "#mobile/core/services/AuthService.ts";
import { ClipboardService } from "#mobile/core/services/ClipboardService.ts";
import { KeyboardService } from "#mobile/core/services/KeyboardService.ts";
import { UpdateService } from "#mobile/core/services/UpdateService.ts";

const native = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform() as "ios" | "android";
const liveUpdate = native && Capacitor.isPluginAvailable("LiveUpdate");

if (liveUpdate) void UpdateService.ready();

/**
 * The mobile app's runtime: the GUI in a Capacitor webview, or the web's in a
 * browser (Vite's dev server, opened outside the app).
 */
export const runtime: ClientRuntime = native
	? {
			platform,
			// Capacitor hands a new window to the system browser.
			open: RuntimeUtils.web.open,
			auth: Capacitor.isPluginAvailable("App") ? AuthService : undefined,
			copy: Capacitor.isPluginAvailable("Clipboard")
				? ClipboardService.copy
				: undefined,
			onKeyboard: Capacitor.isPluginAvailable("keyboard")
				? KeyboardService.onKeyboard
				: undefined,
			getModelProviders: async () => {
				if (!Capacitor.isPluginAvailable("afmize")) return [];
				const { AFMProvider } = await import(
					"#mobile/core/services/AfmService.ts"
				);
				return [AFMProvider];
			},
			update: liveUpdate ? UpdateService.create(platform) : undefined,
		}
	: RuntimeUtils.web;
