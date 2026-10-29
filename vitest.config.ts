import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: ["apps/*", "packages/*", "!apps/{desktop,mobile}"],
		silent: "passed-only",
		coverage: {
			provider: "v8",
			include: ["{apps,packages}/*/src/**/*.{ts,tsx}"],
			exclude: [
				...coverageConfigDefaults.exclude,
				"{apps,packages}/*/src/**/*.{test,spec}.{ts,tsx}",
			],
		},
	},
});
