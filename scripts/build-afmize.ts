import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "./spawn.ts";
import { create, printout } from "./use-stdout.ts";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "../vendor/afmize");
const PRODUCT = "dynafmize";

type Configuration = "debug" | "release";

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

const builds = new Map<Configuration, Promise<string | null>>();

const build = async (configuration: Configuration) => {
	// Apple Foundation Models only exist on macOS; anywhere else the CLI is
	// built without them.
	if (process.platform !== "darwin") return null;

	const update = create(`building afmize (${configuration})`);

	// A release from CI has to carry it; a local build only loses AFM.
	const fail = (details: string) => {
		update("failed to build afmize", process.env.CI ? "error" : "warning");
		printout({ stdout: "", stderr: details });
		if (process.env.CI) throw new Error("afmize is required in CI");
		return null;
	};

	if (!existsSync(join(PACKAGE, "Package.swift"))) {
		return fail(`${PACKAGE} is empty; run \`git submodule update --init\``);
	}

	const args = [
		"build",
		"--package-path",
		PACKAGE,
		"--configuration",
		configuration,
		"--product",
		PRODUCT,
	];
	const built = await swift(args);
	if (built.code !== 0) return fail(built.output);

	// SwiftPM's layout differs between toolchains, so it is asked where.
	const bin = await swift([...args, "--show-bin-path"]);
	const library = join(
		bin.stdout.trim().split("\n").at(-1) ?? "",
		`lib${PRODUCT}.dylib`,
	);
	if (bin.code !== 0 || !existsSync(library)) {
		return fail(`${library} was not produced\n${bin.output}`);
	}

	update("built afmize");
	return library;
};

/**
 * afmize's dynamic library, built once per process for the CLI to embed —
 * null where it cannot be built (anywhere but macOS, or without a Swift
 * toolchain that has the FoundationModels SDK), which only leaves AFM out.
 */
export const buildAfmize = (configuration: Configuration) => {
	let library = builds.get(configuration);
	if (!library) {
		library = build(configuration);
		builds.set(configuration, library);
	}
	return library;
};
