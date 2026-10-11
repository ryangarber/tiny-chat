#!/usr/bin/env node

import { zClientEnv } from "#core/core/types/env.ts";
import { spawn } from "../../../scripts/spawn.ts";
import { useEnv } from "../../../scripts/use-env.ts";
import { buildNative } from "./native.ts";

/**
 * A release of the desktop app for this host, against the production server:
 * the app and its installer under `build/`, and what the updater downloads
 * under `artifacts/`. `--env=canary` builds for the canary channel instead.
 */
const channel =
	process.argv.find((arg) => arg.startsWith("--env="))?.slice(6) ?? "stable";

process.env.DEV = "";
process.env.DEV_HOST = "";
process.env.DEV_REMOTE = "";
useEnv({ type: zClientEnv });

await spawn({
	command: ["pnpm", "exec", "electrobun", "prepare"],
	label: ["electrobun prepare", "preparing electrobun"],
	output: "tail",
});
await buildNative("release");
await spawn({
	command: ["pnpm", "exec", "vite", "build"],
	label: ["gui build", "building gui"],
	output: "tail",
});
await spawn({
	command: ["pnpm", "exec", "electrobun", "build", `--env=${channel}`],
	label: [`${channel} app build`, `building ${channel} app`],
	output: "tail",
});
