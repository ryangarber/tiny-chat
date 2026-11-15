#!/usr/bin/env node

import { log, proc } from "@ryangarber/utils";
import { concurrently } from "concurrently";
import { zClientEnv } from "#core/core/types/env.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { useEnv } from "../../../scripts/use-env.ts";
import { useServer } from "../../../scripts/use-server.ts";

/**
 * The app against the dev server: `dev.ts ios|android|electron [--dist]
 * [cap run args]`. By default the app loads the GUI from Vite with HMR; with
 * `--dist` it loads a build of it, as a release does.
 *
 * On a phone or emulator, over this machine's network address; without
 * `--target`, `cap run` asks which device to run on. On this machine,
 * Electron, whose main process (the `Desktop` plugin, `apps/app/electron-plugin`) is
 * rebuilt and relaunched on changes unless `--no-watch app`.
 */
const [platform, ...rest] = process.argv.slice(2);
if (platform !== "ios" && platform !== "android" && platform !== "electron") {
	throw new Error("usage: dev.ts ios|android|electron [--dist] [cap run args]");
}
const dist = rest.includes("--dist");
const args = rest.filter((arg) => arg !== "--dist");
const electron = platform === "electron";

const env = useEnv({ type: zClientEnv, remote: !electron });
const cleanup = await useServer({ execPath: "node", quiet: true });

/** Capacitor's name for Electron, which is a platform package's. */
const ELECTRON = "@capawesome/capacitor-electron";

const cap = `pnpm exec cap run ${platform} ${args.map((arg) => `"${arg}"`).join(" ")}`;

/**
 * Electron's project, synced (with the GUI's build, if there is one) and
 * compiled, then launched as `cap run` would, but by `run-electron.ts`,
 * which relaunches it when its main process changes.
 */
const runElectron = async (url?: string) => {
	const { watch } = CommonUtils.getWatchMode("app");
	await proc({
		title: "Building main process",
		command: ["pnpm", "--filter", "app-electron-plugin", "run", "build"],
	});
	await proc({
		title: "Syncing electron",
		command: ["pnpm", "exec", "cap", url ? "update" : "sync", ELECTRON],
	});
	await proc({
		title: "Compiling electron",
		command: ["pnpm", "--filter", "app-electron", "run", "build"],
	});
	const run = `node ./scripts/run-electron.ts${watch ? " --watch" : ""}`;
	await concurrently(
		[
			...(url ? [{ command: "pnpm exec vite", name: "gui" }] : []),
			...(watch
				? [
						{
							command: "pnpm --filter app-electron-plugin run dev",
							name: "app-electron-plugin",
						},
					]
				: []),
			{
				command: url ? `wait-on ${url} && ${run}` : run,
				name: "app-electron",
				env: url ? { CAPACITOR_ELECTRON_DEV_SERVER_URL: url } : {},
			},
		],
		{ killOthersOn: ["success", "failure"], prefixColors: "auto" },
	).result;
};

try {
	if (electron) {
		if (dist) {
			await proc({
				title: "Building GUI",
				command: ["pnpm", "exec", "vite", "build"],
			});
			await runElectron();
		} else {
			await runElectron(`http://localhost:${env.VITE_WEB_PORT}`);
		}
	} else if (dist) {
		await proc({
			title: "Building GUI",
			command: ["pnpm", "exec", "vite", "build"],
		});
		await concurrently([{ command: cap, name: "cap", raw: true }]).result;
		// `cap run` returns once the app is installed; the app still needs the
		// server until it is stopped.
		log({ message: "Running... Ctrl-C to stop" });
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
