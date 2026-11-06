#!/usr/bin/env bun

import { proc } from "@ryangarber/utils";
import { compile } from "./compile.ts";

const result = await compile({ compile: { outfile: "./dist/tiny-chat" } });

if (!result?.success) {
	process.exit(1);
}

await proc({
	title: "Checking outputs",
	command: [result.outputs[0].path, "--help"],
	errors: "exit",
});
