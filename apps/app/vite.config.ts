import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import { defineGuiConfig } from "../../packages/gui/vite.config.ts";

const root = fileURLToPath(new URL("./", import.meta.url));

/** The native projects and builds, which hold copies of the GUI's build. */
const native = ["dist", "build", "ios", "android", "electron"].map((dir) =>
	join(root, dir, "**"),
);

/**
 * The app's one build of the GUI: what the web serves (`scripts/serve.ts`)
 * and what `cap sync` copies into iOS, Android and Electron.
 */
export default mergeConfig(defineGuiConfig({ root }), {
	optimizeDeps: { entries: ["index.html"] },
	server: { watch: { ignored: native } },
	define: {
		// A release's `zMobileRelease` from `scripts/build.ts`; empty in dev
		// and on the web, which never update.
		"import.meta.env.MOBILE_RELEASE": JSON.stringify(
			process.env.MOBILE_RELEASE ?? "",
		),
	},
});
