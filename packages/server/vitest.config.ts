import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.base.ts";

export default mergeConfig(
	{ ...baseConfig, test: { ...baseConfig.test, globalSetup: [] } },
	defineConfig({
		test: {
			setupFiles: ["./src/tests.ts"],
		},
	}),
);
