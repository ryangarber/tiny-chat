#!/usr/bin/env node

import { stripVTControlCharacters } from "node:util";
import { log, proc } from "@ryangarber/utils";

const { code, stderr } = await proc({
	title: "Checking GUI",
	command: ["pnpm", "exec", "vite", "build"],
	errors: "resolve",
});

const output = stripVTControlCharacters(stderr);
const externalized = [
	...output.matchAll(
		/Module "([^"]+)" has been externalized for browser compatibility, imported by "([^"]+)"/g,
	),
];

if (code !== 0) {
	log({ message: "Build failed", level: "error" });
	process.exit(1);
} else if (
	externalized.length > 0 ||
	output.split("has been externalized").length - 1 !== externalized.length
) {
	log({
		message: "Build externalized a dependency",
		details: externalized
			.map(([, module, importer]) => `${module} (${importer})`)
			.join("\n"),
		level: "error",
	});
	process.exit(1);
} else {
	log({ message: "Build succeeded" });
}
