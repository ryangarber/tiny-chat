import { Command } from "@commander-js/extra-typings";
import { main } from "#cli/main.tsx";
import { useConsoleStore } from "#client/core/stores/useConsoleStore.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { createLogger } from "#core/logger.ts";
import workspace from "../../../package.json" with { type: "json" };

// Silent in dev too: anything printed under Ink, even through its console
// patch, throws away the incremental render for a full redraw. Logs are kept
// for `/console` and on disk instead.
createLogger({
	logWriter: useConsoleStore.getState().writer,
	logToDisk: true,
	silent: true,
});

const cli = new Command()
	.name("tiny-chat")
	.description("Tiny Chat in the terminal.")
	.version(
		workspace.version + (CommonUtils.isTruthy(process.env.DEV) ? "-dev" : ""),
	)
	.option("--no-keyring", "use alternative session");

cli.action(async (options) => {
	await main(options.keyring);
});

export { cli };
