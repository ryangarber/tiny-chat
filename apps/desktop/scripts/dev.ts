#!/usr/bin/env node

import { concurrently } from "concurrently";
import { zClientEnv } from "#core/core/types/env.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { spawn } from "../../../scripts/spawn.ts";
import { useEnv } from "../../../scripts/use-env.ts";
import { useServer } from "../../../scripts/use-server.ts";
import { buildNative } from "./native.ts";

/**
 * The desktop app against the dev server. By default the window loads the
 * GUI from Vite with HMR; with `--dist` it loads a build of it, as a release
 * does. Either way the main process is rebuilt and relaunched on changes.
 */
const { watch } = CommonUtils.getWatchMode("desktop");

const dist = process.argv.includes("--dist");

const env = useEnv({ type: zClientEnv });
const cleanup = await useServer({ execPath: "node", quiet: true });

await spawn({
	command: ["pnpm", "exec", "electrobun", "prepare"],
	label: ["electrobun prepare", "preparing electrobun"],
	output: "tail",
});
await buildNative("debug");

try {
	if (dist) {
		await spawn({
			command: ["pnpm", "exec", "vite", "build"],
			label: ["gui build", "building gui"],
			output: "tail",
		});
		await concurrently(
			[
				{
					command: `pnpm exec electrobun dev ${watch ? "--watch" : ""}`,
					name: "desktop",
				},
			],
			{ prefixColors: "auto" },
		).result;
	} else {
		const url = `http://localhost:${env.VITE_WEB_PORT}`;
		await concurrently(
			[
				{ command: "pnpm exec vite", name: "gui" },
				{
					command: `wait-on ${url} && pnpm exec electrobun dev ${watch ? "--watch" : ""}`,
					name: "desktop",
					env: { DESKTOP_DEV_URL: url },
				},
			],
			{ killOthersOn: ["success", "failure"], prefixColors: "auto" },
		).result;
	}
} catch (error) {
	if (error instanceof Error) throw error;
	// `concurrently` rejects with its commands' exit events; each reported its
	// own failure already.
	process.exitCode = 1;
} finally {
	await cleanup();
}
