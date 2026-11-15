import type { KnipConfig } from "knip";

export default {
	tags: ["-lintignore"],
	workspaces: {
		".": {},
		"apps/app": {
			// Its Vite root resolves them for the GUI's React, which it mounts.
			ignoreDependencies: ["react", "react-dom"],
		},
	},
	ignore: [
		"**/generated/**",
		"**/scripts/**",
		"**/pm2.config.mjs",
		"**/prisma/**",
		"**/electron-builder.config.js",
	],
	ignoreDependencies: [
		"events",
		"ink-testing-library",
		"babel-plugin-react-compiler",
		"prisma-orm-extension-zod",
		"playwright",
		"@capawesome/capacitor-assets",
		// Shipped beside the desktop's main process rather than bundled into it.
		"@cursor/sdk",
		// Run by apps/app/scripts/build.ts in the Electron project.
		"electron-builder",
	],
	ignoreBinaries: ["actionlint"],
	preprocessor: ["./scripts/setup-knip.ts"],
} satisfies KnipConfig;
