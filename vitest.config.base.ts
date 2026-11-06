import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["./src/**/*.{test,spec}.{ts,tsx}"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
		globals: true,
		globalSetup: [
			fileURLToPath(new URL("./scripts/setup-test.ts", import.meta.url)),
		],
		passWithNoTests: true,
		silent: "passed-only",
	},
});
