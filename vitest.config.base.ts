import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		{
			name: "strip-broken-sourcemaps",
			enforce: "pre",
			load(id) {
				if (!id.includes("rrule/dist/esm")) return null;
				const code = readFileSync(id, "utf-8");
				return {
					code: code.replace(/\/\/# sourceMappingURL=\S+/, ""),
					map: { mappings: "" },
				};
			},
		},
	],
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
