import { join } from "node:path";
import { fileURLToPath } from "node:url";
import RolldownBabel from "@rolldown/plugin-babel";
import ViteTailwind from "@tailwindcss/vite";
import ViteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import RolldownVisualizer from "rollup-plugin-visualizer";
import ViteTailwindMantine from "tailwind-preset-mantine/vite";
import { type Alias, defineConfig, mergeConfig } from "vite";
import ViteInspect from "vite-plugin-inspect";
import { zClientEnv } from "#core/core/types/env.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { useEnv } from "../../scripts/use-env.ts";
import baseConfig from "../../vitest.config.base.ts";

// biome-ignore lint/correctness/useHookAtTopLevel: not a hook
const env = useEnv({ type: zClientEnv });

/**
 * The GUI's build, for the web or for a host app: `runtime` replaces
 * `#gui/client-runtime.ts` with the host's own module, `alias` resolves what
 * that module imports, and `dist` is where the host takes the build from.
 */
export function defineRuntimeConfig({
	runtime,
	alias = [],
	dist = fileURLToPath(new URL("./dist", import.meta.url)),
}: {
	runtime?: string;
	alias?: Alias[];
	dist?: string;
} = {}) {
	return mergeConfig(
		baseConfig,
		defineConfig({
			root: fileURLToPath(new URL("./", import.meta.url)),
			base: "./",
			clearScreen: false,
			build: {
				rolldownOptions: {
					external: [/^(node:)?(path|fs)$/],
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
				ViteTailwindMantine({ input: "src/theme.tsx" }),
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
				// Vitest browser mode excludes @opentelemetry/api from pre-bundling, so
				// optimized deps (@anthropic-ai/sdk) keep a bare import that pnpm can't
				// resolve from the cache dir; dedupe resolves it from this package
				dedupe: ["@opentelemetry/api"],
				alias: [
					...(runtime
						? [{ find: "#gui/client-runtime.ts", replacement: runtime }]
						: []),
					...alias,
				],
			},
			server: {
				port: parseInt(process.env.VITE_WEB_PORT as string, 10),
				strictPort: true,
				host: "0.0.0.0",
				hmr: CommonUtils.getWatchMode("gui").watch,
			},
			cacheDir: "../../node_modules/.vite",
			test: {
				setupFiles: ["./src/tests.ts"],
				include: ["**/*.test.tsx"],
				browser: {
					enabled: true,
					provider: playwright({ launchOptions: { channel: "chromium" } }),
					instances: [{ browser: "chromium" }],
				},
			},
		}),
	);
}

export default defineRuntimeConfig();
