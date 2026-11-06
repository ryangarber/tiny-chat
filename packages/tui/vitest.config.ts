import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		// `better-ink-picture` is linked from outside the repo, where its own
		// React and Ink would otherwise be loaded beside these.
		resolve: { dedupe: ["react", "react-reconciler", "ink"] },
		test: {
			setupFiles: ["./src/tests.ts"],
		},
	}),
);
