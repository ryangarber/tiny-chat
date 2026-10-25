import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		{
			name: "strip-broken-sourcemaps",
			enforce: "pre",
			load(id) {
				if (!id.includes("rrule/dist/esm")) return null;
				const code = fs.readFileSync(id, "utf-8");
				return {
					code: code.replace(/\/\/# sourceMappingURL=\S+/, ""),
					map: { mappings: "" },
				};
			},
		},
	],
	test: {
		include: ["**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
		globals: true,
		globalSetup: [
			join(dirname(fileURLToPath(import.meta.url)), "./scripts/setup-test.ts"),
		],
		passWithNoTests: true,
		coverage: {
			provider: "v8",
		},
	},
});
