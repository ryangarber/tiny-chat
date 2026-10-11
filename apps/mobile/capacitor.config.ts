import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The GUI's Vite server while `scripts/dev.ts` runs it with HMR; otherwise
 * the app loads the build `cap sync` copied into it.
 */
const url = process.env.MOBILE_DEV_URL;

const config: CapacitorConfig = {
	appId: "dev.ryangarber.chat",
	appName: "Tiny Chat",
	webDir: "./dist",
	...(url ? { server: { url, cleartext: true } } : {}),
	plugins: {
		LiveUpdate: {
			// A live update that never calls `ready()` (`UpdateService`) is rolled
			// back to the build the binary shipped with.
			readyTimeout: 10000,
			autoDeleteBundles: true,
		},
	},
	experimental: {
		ios: {
			spm: {
				swiftToolsVersion: "6.4",
			},
		},
	},
};

export default config;
