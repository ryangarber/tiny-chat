#!/usr/bin/env node

import { log, proc } from "@ryangarber/utils";

const { code, stderr } = await proc({
	title: "Checking GUI",
	command: ["pnpm", "-w", "build:gui"],
	errors: "resolve",
});

if (code !== 0) {
	log({ message: "Build failed", level: "error" });
	process.exit(1);
} else if (stderr.includes("has been externalized")) {
	log({ message: "Build externalized a dependency", level: "error" });
	process.exit(1);
} else {
	log({ message: "Build succeeded" });
}
