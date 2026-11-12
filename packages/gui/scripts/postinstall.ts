import { log, proc } from "@ryangarber/utils";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

const install = (withDeps: boolean) =>
	proc({
		title: withDeps
			? "Installing Playwright with system dependencies"
			: "Installing Playwright",
		command: [
			"pnpm",
			"exec",
			"playwright",
			"install",
			...(withDeps ? ["--with-deps"] : []),
			"chromium",
		],
		stdio: "inherit",
		errors: withDeps ? "resolve" : "exit",
	});

if (
	!CommonUtils.isTruthy(process.env.CI) ||
	CommonUtils.isTruthy(process.env.CI_TESTING)
) {
	const withDeps =
		process.platform === "linux" &&
		!CommonUtils.isTruthy(process.env.PLAYWRIGHT_SKIP_DEPS);
	if (!withDeps || (await install(true)).code !== 0) {
		if (withDeps) {
			log({
				message: "Installing Playwright's system dependencies failed",
				details: "Retrying without --with-deps",
				level: "warning",
			});
		}
		await install(false);
	}
} else {
	log({ message: "Skipping Playwright" });
}
