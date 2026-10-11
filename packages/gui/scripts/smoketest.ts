#!/usr/bin/env node

import { spawn } from "../../../scripts/spawn.ts";
import { create, printout } from "../../../scripts/use-stdout.ts";

const update = create("trying build");

const { code, stdout, stderr } = await spawn({
	command: ["pnpm", "-w", "build:gui"],
	errors: "resolve",
	output: false,
});

function trim(log: string) {
	const lines: string[] = [];
	let hidden = 0;
	for (const line of log.split("\n")) {
		if (/(dist\/).*(kB|MB)/.test(line)) {
			hidden++;
		} else if (hidden > 0) {
			lines.push(`... ${hidden} assets hidden ...`);
			hidden = 0;
		} else {
			lines.push(line);
		}
	}
	return lines.join("\n");
}

const out = { stdout: trim(stdout), stderr: trim(stderr) };
if (code !== 0) {
	update("build failed", "error");
	printout(out);
	process.exit(1);
} else if (stderr.includes("has been externalized")) {
	update("build externalized a dependency", "error");
	printout(out);
	process.exit(1);
} else {
	update("build succeeded");
	printout(out);
}
