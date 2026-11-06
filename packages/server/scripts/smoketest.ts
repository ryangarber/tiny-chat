#!/usr/bin/env node

import { log, proc } from "@ryangarber/utils";

const { code, error, stdout, stderr } = await proc({
	title: "Checking server",
	command: ["pnpm", "-w", "start:server", "--", "--smoke"],
	signal: AbortSignal.timeout(30_000),
	errors: "resolve",
});

const timedOut = error?.name === "AbortError";
if (!timedOut && (stdout + stderr).includes("EADDRINUSE")) {
	log({ message: "Server started but port is in use", level: "warning" });
} else if (timedOut) {
	log({ message: "Timed out waiting for server to start", level: "error" });
	process.exitCode = 1;
} else if (code !== 0) {
	log({ message: "Server failed to start", level: "error" });
	process.exitCode = 1;
} else {
	log({ message: "Server started successfully" });
}
