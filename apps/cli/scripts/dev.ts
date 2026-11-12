#!/usr/bin/env bun

import { type ChildProcess, spawn } from "node:child_process";
import { watch } from "node:fs/promises";
import { resolve } from "node:path";
import { log } from "@ryangarber/utils";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { useServer } from "../../../scripts/use-server.ts";
import { setExitHandler, setPassthrough } from "../../../scripts/use-stdout.ts";
import { compile } from "./compile.ts";

const { watch: watchMode, argv } = CommonUtils.getWatchMode("cli");

let child: ChildProcess | undefined;
async function run() {
	if (child) {
		const previous = child;
		child = undefined;
		previous.kill();
		setPassthrough(false);
	}

	const result = await compile({
		outdir: "./dist",
		target: "bun",
		sourcemap: "inline",
		external: ["@napi-rs/keyring", "@crosscopy/clipboard"],
		dev: true,
		metafile: true,
	});

	const entrypoint = result?.outputs?.find(
		({ path }) => path.split(/[/\\]/).at(-1) === "index.js",
	);
	if (!entrypoint) {
		log({ level: "warning", message: "No entrypoint found" });
		return null;
	}

	const args = ["bun", entrypoint.path, ...argv.slice(2)];
	log({ message: "Running", details: `> ${args.join(" ")}` });

	const started = spawn(args[0], args.slice(1), {
		stdio: "inherit",
		env: { ...process.env },
	});
	child = started;
	setPassthrough(true);

	started.on("exit", (code, signal) => {
		if (child !== started) return;
		child = undefined;
		setPassthrough(false);

		log({
			level: code === 0 ? "info" : "warning",
			message: `Exited with code ${code} ${signal}`,
		});

		if (watchMode) log({ message: "Waiting for changes" });
	});

	if (!result?.metafile) {
		log({ level: "warning", message: "No metafile found" });
		return null;
	}

	return Object.keys(result.metafile.inputs)
		.map((p) => resolve(process.cwd(), p))
		.filter((p) => !p.includes("/node_modules/"));
}

const abort = new AbortController();

let lastInputs: string[] | null = null;
async function reload(inputs: string[] | null) {
	try {
		inputs ??= lastInputs;
		lastInputs = inputs;

		if (!inputs) {
			log({ level: "warning", message: "Nothing to watch" });
			return;
		}

		log({ message: `Watching ${inputs.length} files` });
		const event = await Promise.any(
			inputs.map(async (input) => {
				return watch(input, { signal: abort.signal })
					[Symbol.asyncIterator]()
					.next();
			}),
		);

		log({ message: `↻ Changes: ${event.value?.filename}` });
		const newInputs = await run();
		await reload(newInputs);
	} finally {
		abort.abort();
	}
}

const cleanup = await useServer({ execPath: "node", quiet: true });

setExitHandler((isCtrlD) => {
	if (child?.pid) {
		if (!isCtrlD) return true;
		child.kill();
	}
	void cleanup().then(() => process.exit(0));
	return true;
});

try {
	const inputs = await run();

	if (!watchMode && child) {
		const running = child;
		await new Promise<void>((resolve) => running.once("exit", () => resolve()));
	}

	if (watchMode) {
		await reload(inputs);
	}
} finally {
	child?.kill();
	await cleanup();
}
