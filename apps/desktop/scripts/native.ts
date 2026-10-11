import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "../../../scripts/spawn.ts";
import { create, printout } from "../../../scripts/use-stdout.ts";

const PACKAGE = fileURLToPath(new URL("../afmize-host", import.meta.url));
const NATIVE = fileURLToPath(new URL("../native/", import.meta.url));
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

const swift = async (args: string[]) => {
	const { code, error, stdout, stderr } = await spawn({
		command: ["swift", ...args],
		errors: "resolve",
		output: false,
	});
	return {
		code,
		stdout,
		output: `${stdout}${stderr}${error ? String(error) : ""}`,
	};
};

/**
 * `afmize-host`, for Apple Foundation Models: null where it cannot be built
 * (anywhere but macOS, or without a Swift toolchain that has the
 * FoundationModels SDK), which only leaves AFM out — except in CI, where a
 * release has to carry it.
 */
async function buildAfmizeHost(configuration: "debug" | "release") {
	if (process.platform !== "darwin") return null;

	const update = create(`building afmize-host (${configuration})`);
	const fail = (details: string) => {
		update("failed to build afmize-host", process.env.CI ? "error" : "warning");
		printout({ stdout: "", stderr: details });
		if (process.env.CI) throw new Error("afmize-host is required in CI");
		return null;
	};

	const args = ["build", "--package-path", PACKAGE, "-c", configuration];
	const built = await swift(args);
	if (built.code !== 0) return fail(built.output);

	// SwiftPM's layout differs between toolchains, so it is asked where.
	const bin = await swift([...args, "--show-bin-path"]);
	if (bin.code !== 0) return fail(bin.output);

	update("built afmize-host");
	return `${bin.stdout.trim().split("\n").at(-1)}/afmize-host`;
}

/**
 * Builds what `electrobun.config.ts` copies into the app beside the GUI:
 * `afmize-host`, on a Mac that can build it. Also makes sure `dist`, the
 * GUI's build, exists for `electrobun.config.ts` to copy; a dev build with
 * HMR loads the GUI from Vite instead, and leaves it as it is.
 */
export async function buildNative(configuration: "debug" | "release") {
	await mkdir(DIST, { recursive: true });
	await rm(NATIVE, { recursive: true, force: true });
	await mkdir(NATIVE, { recursive: true });
	const host = await buildAfmizeHost(configuration);
	if (host) await copyFile(host, `${NATIVE}afmize-host`);
}
