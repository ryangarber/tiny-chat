import { log, proc } from "@ryangarber/utils";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

if (
	!CommonUtils.isTruthy(process.env.CI) ||
	CommonUtils.isTruthy(process.env.CI_TESTING)
) {
	await proc({
		title: "Installing Playwright",
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
	log({ message: "Skipping Playwright" });
}
