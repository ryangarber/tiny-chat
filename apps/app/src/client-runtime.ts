import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { AuthService } from "#app/core/services/AuthService.ts";
import { ClipboardService } from "#app/core/services/ClipboardService.ts";
import { KeyboardService } from "#app/core/services/KeyboardService.ts";
import { UpdateService } from "#app/core/services/UpdateService.ts";
import type { ClientRuntime } from "#gui/core/types/runtime.ts";
import { RuntimeUtils } from "#gui/core/utils/RuntimeUtils.ts";

const native = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform() as "ios" | "android" | "electron";

/**
 * The desktop app: Capacitor on Electron, whose main process is the
 * `Desktop` plugin (`apps/app/electron-plugin`). Its URL scheme is only registered for
 * the GUI it built in (`electron/capacitor.electron.config.ts`), not for the
 * Vite server's. Loaded only there, so the web and phones go without it.
 */
const createDesktop = async (): Promise<ClientRuntime> => ({
	...(await import("#app-electron-plugin/runtime.ts")).DesktopRuntime.create(),
	auth:
		window.location.protocol === "capacitor-electron:"
			? AuthService
			: undefined,
	quit: () => App.exitApp(),
});

/** The mobile app: Capacitor on iOS or Android. */
const createMobile = (platform: "ios" | "android"): ClientRuntime => {
	const liveUpdate = Capacitor.isPluginAvailable("LiveUpdate");
	if (liveUpdate) void UpdateService.ready();
	return {
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
			if (!Capacitor.isPluginAvailable("Afmize")) return [];
			const { AFMProvider } = await import("#app/core/services/AfmService.ts");
			return [AFMProvider];
		},
		update: liveUpdate ? UpdateService.create(platform) : undefined,
	};
};

/**
 * The app's runtime: the GUI in its webview on a desktop or a phone, or
 * the web's in a browser, where the same build is served (`scripts/serve.ts`)
 * or its dev server is opened.
 */
export const createRuntime = async (): Promise<ClientRuntime> =>
	!native
		? RuntimeUtils.web
		: platform === "electron"
			? await createDesktop()
			: createMobile(platform);
