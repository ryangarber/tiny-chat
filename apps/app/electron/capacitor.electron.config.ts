import { defineConfig } from "@capawesome/capacitor-electron/config";
import { app } from "electron";

/**
 * The GUI's Vite server while `scripts/dev.ts` runs it with HMR; otherwise
 * the window loads the build `cap sync` copied into `app/`.
 */
const dev = Boolean(process.env.CAPACITOR_ELECTRON_DEV_SERVER_URL);

/**
 * The GUI's: an inline shim and web fonts in `index.html`, WebAssembly for
 * highlighting, and whatever images, media and servers a chat links to, as
 * in a browser tab. React DevTools' standalone server too, in dev.
 */
const csp = (devServer: boolean) =>
	[
		"default-src 'self'",
		`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${devServer ? " 'unsafe-eval' http://localhost:8097" : ""}`,
		"style-src 'self' 'unsafe-inline' https:",
		"img-src 'self' http: https: data: blob:",
		"media-src 'self' http: https: data: blob:",
		"font-src 'self' https: data:",
		"connect-src 'self' http: https: ws: wss: data: blob:",
		"worker-src 'self' blob:",
		"frame-src https:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");

export default defineConfig({
	window: {
		width: 1280,
		height: 720,
		minWidth: 360,
		minHeight: 480,
	},
	csp: {
		policy: csp(false),
		devPolicy: csp(true),
	},
	// A sign-in in the browser returns here (`CommonUtils.nativeAuthCallbackUrl`),
	// through `@capacitor/app`'s `appUrlOpen`. Not for a dev build on the Vite
	// server, whose GUI signs in without it (`client-runtime.ts`), and which
	// would otherwise take the scheme from an installed app.
	deepLinks: dev ? undefined : { scheme: "tinychat" },
	hooks: {
		beforeReady: () => {
			// Closing the window quits, on macOS too: there is only the one.
			app.on("window-all-closed", () => app.quit());
		},
	},
});
