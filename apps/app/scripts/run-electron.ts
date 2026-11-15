#!/usr/bin/env node

import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * The desktop app, as `cap run` would launch it, from `electron/` once it is
 * synced and compiled: `run-electron.ts [--watch]`. With `--watch`, it is
 * relaunched whenever the `Desktop` plugin's main process is rebuilt
 * (`apps/app/electron-plugin`'s `vite build --watch`); otherwise this exits with it.
 */
const relaunch = process.argv.includes("--watch");

const electron = fileURLToPath(new URL("../electron/", import.meta.url));
const plugin = fileURLToPath(
	new URL("../electron-plugin/electron/dist/", import.meta.url),
);

/** Electron's own binary, as its package names it, so a kill reaches it. */
const binary = createRequire(`${electron}package.json`)("electron") as string;

let child: ChildProcess | undefined;
let restarting = false;
/** Whether it is being stopped, which is no failure of its own. */
let stopping = false;

const start = () => {
	child = spawn(binary, ["."], { cwd: electron, stdio: "inherit" });
	child.once("exit", (code, signal) => {
		child = undefined;
		if (restarting) {
			restarting = false;
			start();
		} else {
			process.exit(stopping ? 0 : (code ?? (signal ? 1 : 0)));
		}
	});
};

/** What a build wrote, to tell a change from the same build written again. */
const hash = () => {
	try {
		return createHash("sha256")
			.update(readFileSync(`${plugin}plugin.mjs`))
			.digest("hex");
	} catch {
		return undefined;
	}
};

if (relaunch) {
	let timer: NodeJS.Timeout | undefined;
	let built = hash();
	watch(plugin, (_, file) => {
		if (file !== "plugin.mjs") return;
		// A build writes its chunks one after another.
		clearTimeout(timer);
		timer = setTimeout(() => {
			const next = hash();
			if (!child || !next || next === built) return;
			built = next;
			console.log("[run-electron] The main process changed; relaunching");
			restarting = true;
			child.kill();
		}, 300);
	});
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		restarting = false;
		stopping = true;
		if (child) child.kill(signal);
		else process.exit(0);
	});
}

start();
