import type { KnipConfig } from "knip";

export default {
	tags: ["-lintignore"],
	workspaces: {
		".": {},
	},
	ignore: [
		"**/generated/**",
		"**/scripts/**",
		"**/pm2.config.mjs",
		"**/prisma/**",
		"**/electrobun.config.ts",
		"**/hutch.config.ts",
	],
	ignoreDependencies: [
		"events",
		"ink-testing-library",
		"babel-plugin-react-compiler",
		"@ryangarber/prisma-orm-extension-zod",
		"playwright",
		"@capawesome/capacitor-assets",
	],
	ignoreBinaries: ["actionlint"],
	preprocessor: ["./scripts/setup-knip.ts"],
} satisfies KnipConfig;
