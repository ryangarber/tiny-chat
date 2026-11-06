#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { proc } from "@ryangarber/utils";
import { zClientEnv } from "#core/core/types/env.ts";
import { useEnv } from "../../../scripts/use-env.ts";

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

await proc({
	title: "Preparing electrobun",
	command: ["pnpm", "exec", "electrobun", "prepare"],
});
// What `electrobun.config.ts` copies, before the GUI is built into it.
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await proc({
	title: "Building GUI",
	command: ["pnpm", "exec", "vite", "build"],
});
await proc({
	title: `Building app (${channel})`,
	command: ["pnpm", "exec", "electrobun", "build", `--env=${channel}`],
});
