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
	// `--with-deps` installs system libraries through apt, which only applies on Linux and fails whenever the Ubuntu
	// archive is down. The browser itself comes from Playwright's CDN, and GitHub's Ubuntu runners already ship the
	// libraries Chromium needs, so fall back to installing just the browser rather than failing the whole install.
	// Set PLAYWRIGHT_SKIP_DEPS=true to skip apt entirely. During a known Ubuntu archive outage, set SKIP_DEPS_THROUGH
	// to the last day (UTC) to skip apt, so it re-enables on its own afterwards.
	const SKIP_DEPS_THROUGH = "2026-11-11";
	const withDeps =
		process.platform === "linux" &&
		new Date().toISOString().slice(0, 10) > SKIP_DEPS_THROUGH &&
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
