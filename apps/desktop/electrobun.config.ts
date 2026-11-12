import type { ElectrobunConfig } from "electrobun";
import workspace from "../../package.json" with { type: "json" };

export default {
	app: {
		name: "Tiny Chat",
		identifier: "dev.ryangarber.chat",
		version: workspace.version,
		// A sign-in in the browser returns here (`CommonUtils.nativeAuthCallbackUrl`).
		urlSchemes: ["tinychat"],
	},
	build: {
		// Bun rather than Cottontail: Electrobun 2.0.2's Cottontail main
		// process never drains what the webview sends it, so no RPC request is
		// ever answered. Bun's polls for it.
		mainProcess: "bun",
		bun: {
			entrypoint: "src/index.ts",
			// So packages resolve their Bun entries: @afmize/node's carries its
			// library beside the bundle.
			target: "bun",
			// The GUI's Vite server while `scripts/dev.ts` runs it with HMR.
			define: {
				"process.env.DESKTOP_DEV_URL": JSON.stringify(
					process.env.DESKTOP_DEV_URL ?? "",
				),
			},
		},
		// Made by `scripts/dev.ts` and `scripts/build.ts`: the GUI. (Hutch loads
		// this file without the file system, so it always exists, if empty.)
		// And the Cua Driver SDK's platform package, a `node_modules` above the
		// bundle, where the SDK looks for it (`scripts/use-cua-driver.ts`).
		copy: {
			dist: "views/main",
			native: "node_modules",
		},
		// The scripts rebuild these themselves.
		watchIgnore: ["dist/**", "src/client-runtime.ts"],
		mac: {
			// With the identity named in `ELECTROBUN_DEVELOPER_ID` (self-signed
			// "Tiny Chat Code Signing" is enough), so the bundle is signed as
			// `dev.ryangarber.chat` and macOS's privacy grants (Accessibility,
			// Screen Recording) match it, and keep matching after an update.
			// Unsigned, the launcher's ad-hoc signature says neither.
			codesign: Boolean(process.env.ELECTROBUN_DEVELOPER_ID),
			notarize: false,
			bundleCEF: false,
			icons: "assets/icon.icon",
		},
		linux: {
			bundleCEF: true,
			defaultRenderer: "cef",
			icon: "assets/icon.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/icon.ico",
		},
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
	release: {
		// Every release's artifacts are uploaded to its GitHub release, so the
		// latest one's are the update.
		baseUrl: "https://github.com/RyanGarber/tiny-chat/releases/latest/download",
		generatePatch: true,
	},
} satisfies ElectrobunConfig;
