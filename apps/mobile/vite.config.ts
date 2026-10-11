import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import { defineRuntimeConfig } from "../../packages/gui/vite.config.ts";

export default mergeConfig(
	defineRuntimeConfig({
		runtime: fileURLToPath(new URL("./src/client-runtime.ts", import.meta.url)),
		dist: fileURLToPath(new URL("./dist", import.meta.url)),
	}),
	{
		define: {
			// A release's `zMobileRelease` from `scripts/build.ts`; empty in dev,
			// which never updates.
			"import.meta.env.MOBILE_RELEASE": JSON.stringify(
				process.env.MOBILE_RELEASE ?? "",
			),
		},
	},
);
