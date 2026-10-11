#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { create } from "../../../scripts/use-stdout.ts";
import devkit from "../.hutch/devkit/tsconfig.json" with { type: "json" };

const update = create("updating tsconfig");

const original = await readFile(
	new URL("../tsconfig.json", import.meta.url),
	"utf-8",
);

const tab = /^(\s+)"compilerOptions"/gm.exec(original)?.[1];
if (!tab) {
	throw new Error("invalid tsconfig.json");
}

const pathsStartRegex = /^\s*"paths":\s*{\s*\n?/gm;
const pathsStartMatch = pathsStartRegex.exec(original);
if (!pathsStartMatch) {
	throw new Error("invalid tsconfig.json");
}
const pathsStart = pathsStartMatch.index;

const pathsEndRegex = /\n?\s*},?\s*$/gm;
if (!pathsEndRegex.exec(original)) {
	throw new Error("invalid tsconfig.json");
}
const pathsEnd = pathsEndRegex.lastIndex;

const paths = Object.entries(devkit.compilerOptions.paths).map(
	([key, value]) =>
		`${tab.repeat(3)}"${key}": [${value.map((target) => `"${target.replaceAll("./", "./.hutch/devkit/")}"`).join(",")}],`,
);

const updated =
	original.slice(0, pathsStart) +
	`${tab.repeat(2)}"paths": {\n${paths.join("\n")}\n${tab.repeat(2)}},` +
	original.slice(pathsEnd);

await writeFile(new URL("../tsconfig.json", import.meta.url), updated);
update(`updated tsconfig`);
