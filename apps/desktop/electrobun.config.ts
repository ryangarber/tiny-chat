import type { ElectrobunConfig } from "electrobun";
import workspace from "../../package.json" with { type: "json" };

export default {
	app: {
		name: "Tiny Chat",
		identifier: "dev.ryangarber.chat",
		version: workspace.version,
	},
	build: {
		// Bun rather than Cottontail: Electrobun 2.0.2's Cottontail main
		// process never drains what the webview sends it, so no RPC request is
		// ever answered. Bun's polls for it.
		mainProcess: "bun",
		bun: {
			entrypoint: "src/index.ts",
			// The GUI's Vite server while `scripts/dev.ts` runs it with HMR.
			define: {
				"process.env.DESKTOP_DEV_URL": JSON.stringify(
					process.env.DESKTOP_DEV_URL ?? "",
				),
			},
		},
		// Made by `scripts/dev.ts` and `scripts/build.ts`: the GUI, and
		// afmize's library where the host could build it. (Hutch loads this
		// file without the file system, so both always exist, if empty.)
		copy: {
			dist: "views/main",
			native: "native",
		},
		// The scripts rebuild these themselves.
		watchIgnore: ["dist/**", "native/**", "src/client-runtime.ts"],
		mac: {
			codesign: false,
			notarize: false,
			bundleCEF: false,
			icons: "assets/icon.icon",
		},
		linux: {
			bundleCEF: false,
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
