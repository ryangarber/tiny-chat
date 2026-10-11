#!/usr/bin/env node

import { concurrently } from "concurrently";
import { zClientEnv } from "#core/core/types/env.ts";
import { spawn } from "../../../scripts/spawn.ts";
import { useEnv } from "../../../scripts/use-env.ts";
import { useServer } from "../../../scripts/use-server.ts";
import { print } from "../../../scripts/use-stdout.ts";

/**
 * The mobile app on a device or emulator, against the dev server on this
 * machine's network address: `dev.ts ios|android [--dist] [cap run args]`.
 * By default the app loads the GUI from Vite with HMR; with `--dist` it loads
 * a build of it, as a release does. Without `--target`, `cap run` asks which
 * device to run on.
 */
const [platform, ...rest] = process.argv.slice(2);
if (platform !== "ios" && platform !== "android") {
	throw new Error("usage: dev.ts ios|android [--dist] [cap run args]");
}
const dist = rest.includes("--dist");
const args = rest.filter((arg) => arg !== "--dist");

const env = useEnv({ type: zClientEnv, remote: true });
const cleanup = await useServer({ execPath: "node", quiet: true });

const cap = `pnpm exec cap run ${platform} ${args.map((arg) => `"${arg}"`).join(" ")}`;

try {
	if (dist) {
		await spawn({
			command: ["pnpm", "exec", "vite", "build"],
			label: ["gui build", "building gui"],
			output: "tail",
		});
		await concurrently([{ command: cap, name: "cap", raw: true }]).result;
		// `cap run` returns once the app is installed; the app still needs the
		// server until it is stopped.
		print({ message: "running; press Ctrl-C to stop" });
		await new Promise<void>((resolve) => process.once("SIGINT", resolve));
	} else {
		const url = `http://${env.DEV_HOST}:${env.VITE_WEB_PORT}`;
		await concurrently(
			[
				{ command: "pnpm exec vite", name: "gui" },
				{
					command: `wait-on ${url} && ${cap}`,
					name: "cap",
					env: { MOBILE_DEV_URL: url },
					raw: true,
				},
			],
			// Vite stays up even if `cap run` gives up: it can time out waiting
			// for a cold emulator to start an app it has already launched.
			{ prefixColors: "auto" },
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
