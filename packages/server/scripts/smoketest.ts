#!/usr/bin/env node

import { spawn } from "../../../scripts/spawn.ts";
import { create, printout } from "../../../scripts/use-stdout.ts";

const update = create("trying server");

const { code, error, stdout, stderr } = await spawn({
	command: ["pnpm", "-w", "start:server", "--", "--smoke"],
	signal: AbortSignal.timeout(30_000),
	errors: "resolve",
	output: false,
});

const timedOut = error?.name === "AbortError";
if (!timedOut && (stdout + stderr).includes("EADDRINUSE")) {
	update("server started but port is in use", "warning");
} else if (timedOut) {
	update("timed out waiting for server to start", "error");
	process.exitCode = 1;
} else if (code !== 0) {
	update("server failed to start", "error");
	process.exitCode = 1;
} else {
	update("server started successfully");
}
printout({ stdout, stderr });
