import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import plugin from "./package.json" with { type: "json" };

/**
 * The `Desktop` plugin's Electron implementation, `electron/dist/plugin.mjs`
 * (where `@capawesome/capacitor-electron` looks for it): `src/plugin.ts` and
 * the workspace's code it runs, in one module for Electron's main process.
 * The packages in `dependencies` stay out of it: they carry native code or
 * find files beside their own, and the platform's `vendor` ships them with
 * the app instead.
 */
const external = [
	"electron",
	...Object.keys(plugin.dependencies),
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig({
	clearScreen: false,
	resolve: {
		tsconfigPaths: true,
	},
	ssr: {
		noExternal: true,
		target: "node",
	},
	build: {
		ssr: fileURLToPath(new URL("./src/plugin.ts", import.meta.url)),
		outDir: fileURLToPath(new URL("./electron/dist", import.meta.url)),
		// Not between a watch's builds, so what watches the directory
		// (`apps/app/scripts/run-electron.ts`) keeps it.
		emptyOutDir: !process.argv.includes("--watch"),
		target: "node24",
		minify: false,
		sourcemap: true,
		rolldownOptions: {
			external: (id) =>
				external.some((name) => id === name || id.startsWith(`${name}/`)),
			output: {
				format: "es",
				entryFileNames: "plugin.mjs",
				chunkFileNames: "[name]-[hash].mjs",
			},
		},
	},
});
