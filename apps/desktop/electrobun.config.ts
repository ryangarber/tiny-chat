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
		copy: {
			dist: "views/main",
		},
		// The scripts rebuild these themselves.
		watchIgnore: ["dist/**", "src/client-runtime.ts"],
		mac: {
			codesign: false,
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
		exitOnLastWindowClose: true,
	},
	release: {
		// Every release's artifacts are uploaded to its GitHub release, so the
		// latest one's are the update.
		baseUrl: "https://github.com/RyanGarber/tiny-chat/releases/latest/download",
		generatePatch: true,
	},
} satisfies ElectrobunConfig;
