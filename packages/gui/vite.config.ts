import { join } from "node:path";
import { fileURLToPath } from "node:url";
import RolldownBabel from "@rolldown/plugin-babel";
import ViteTailwind from "@tailwindcss/vite";
import ViteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import RolldownVisualizer from "rollup-plugin-visualizer";
import ViteTailwindMantine from "tailwind-preset-mantine/vite";
import { defineConfig, mergeConfig } from "vite";
import ViteInspect from "vite-plugin-inspect";
import { zClientEnv } from "#core/core/types/env.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { useEnv } from "../../scripts/use-env.ts";
import baseConfig from "../../vitest.config.base.ts";

// biome-ignore lint/correctness/useHookAtTopLevel: not a hook
const env = useEnv({ type: zClientEnv });

const gui = fileURLToPath(new URL("./", import.meta.url));

/**
 * The GUI's build, from the app that hosts it: `root` holds its `index.html`,
 * whose entry `mount`s the GUI on the app's runtime, and takes the build in
 * its `dist`. That's `apps/app` (Capacitor), for the web as for iOS, Android
 * and Electron.
 */
export function defineGuiConfig({ root }: { root: string }) {
	const dist = join(root, "dist");
	return defineConfig({
		root,
		base: "./",
		clearScreen: false,
		build: {
			rolldownOptions: {
				external: [/^(node:)?(path|fs)$/, /^@cursor\/sdk$/],
			},
			outDir: dist,
			emptyOutDir: true,
		},
		define: {
			"import.meta.vitest": "undefined",
			...Object.fromEntries(
				Object.entries(env).map(([key, value]) => [
					`import.meta.env.${key}`,
					JSON.stringify(value),
				]),
			),
		},
		plugins: [
			{
				name: "react-devtools",
				apply: "serve",
				transformIndexHtml: () => [
					{
						tag: "script",
						attrs: { src: "http://localhost:8097" },
						injectTo: "body-prepend",
					},
				],
			},
			ViteReact(),
			RolldownBabel({ presets: [reactCompilerPreset()] }),
			ViteTailwind(),
			ViteTailwindMantine({ input: join(gui, "src/theme.tsx") }),
			ViteInspect(),
			RolldownVisualizer({
				filename: join(dist, "stats.html"),
				template: "flamegraph",
			}),
		],
		worker: {
			// Shiki loads grammars and themes on demand, which needs code splitting
			format: "es",
		},
		resolve: {
			tsconfigPaths: true,
		},
		server: {
			port: parseInt(process.env.VITE_WEB_PORT as string, 10),
			strictPort: true,
			host: "0.0.0.0",
			hmr: CommonUtils.getWatchMode("gui").watch,
		},
		cacheDir: join(gui, "../../node_modules/.vite"),
	});
}

/** The GUI's own tests, in a browser. */
export default mergeConfig(
	baseConfig,
	mergeConfig(defineGuiConfig({ root: gui }), {
		resolve: {
			// Vitest browser mode excludes @opentelemetry/api from pre-bundling, so
			// optimized deps (@anthropic-ai/sdk) keep a bare import that pnpm can't
			// resolve from the cache dir; dedupe resolves it from this package
			dedupe: ["@opentelemetry/api"],
		},
		test: {
			setupFiles: ["./src/tests.ts"],
			browser: {
				enabled: true,
				provider: playwright({ launchOptions: { channel: "chromium" } }),
				instances: [{ browser: "chromium" }],
			},
		},
	}),
);
