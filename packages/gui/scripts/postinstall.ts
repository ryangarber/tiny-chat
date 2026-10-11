import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { spawn } from "../../../scripts/spawn.ts";

if (
	!CommonUtils.isTruthy(process.env.CI) ||
	CommonUtils.isTruthy(process.env.CI_TESTING)
) {
	await spawn({
		command: [
			"pnpm",
			"exec",
			"playwright",
			"install",
			"--with-deps",
			"chromium",
		],
		stdio: "inherit",
		errors: "exit",
	});
} else {
	console.log(":: skipping playwright");
}
