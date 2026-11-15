#!/usr/bin/env node

import { stripVTControlCharacters } from "node:util";
import { log, proc } from "@ryangarber/utils";

/**
 * What may import a Node module the build stubs out for the browser: the
 * model providers' local hosts, with what they share (`executable`) and the
 * Claude Agent SDK they run, which the providers import only with no host to
 * connect to. In the app, the desktop's main process runs them instead.
 */
const allowed =
	/\/(@ryangarber\/ai-sdk-providers\/dist\/(local|executable)-[^/]+|@anthropic-ai\/claude-agent-sdk\/[^/]+)\.mjs$/;

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
const unexpected = externalized.filter(
	([, , importer]) => !allowed.test(importer),
);

if (code !== 0) {
	log({ message: "Build failed", level: "error" });
	process.exit(1);
} else if (
	unexpected.length > 0 ||
	// One it couldn't read, which it can't vouch for.
	output.split("has been externalized").length - 1 !== externalized.length
) {
	log({
		message: "Build externalized a dependency",
		details: unexpected
			.map(([, module, importer]) => `${module} (${importer})`)
			.join("\n"),
		level: "error",
	});
	process.exit(1);
} else {
	log({ message: "Build succeeded" });
}
