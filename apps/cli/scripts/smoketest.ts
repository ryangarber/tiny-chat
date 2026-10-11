#!/usr/bin/env bun

import { spawn } from "../../../scripts/spawn.ts";
import { compile } from "./compile.ts";

const result = await compile({ compile: { outfile: "./dist/tiny-chat" } });

if (!result?.success) {
	process.exit(1);
}

await spawn({
	command: [result.outputs[0].path, "--help"],
	label: ["checks", "checking outputs", "checks passed"],
	errors: "exit",
});
