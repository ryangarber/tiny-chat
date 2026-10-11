import { fileURLToPath } from "node:url";
import { defineRuntimeConfig } from "../../packages/gui/vite.config.ts";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

export default defineRuntimeConfig({
	runtime: fileURLToPath(new URL("./src/client-runtime.ts", import.meta.url)),
	// `electrobun/view`, from the devkit `electrobun prepare` projects.
	alias: electrobunViteAliases(
		fileURLToPath(new URL("./.hutch/devkit", import.meta.url)),
	),
	dist: fileURLToPath(new URL("./dist", import.meta.url)),
});
