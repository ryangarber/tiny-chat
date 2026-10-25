import {
	command,
	constant,
	type InferValue,
	message,
	object,
	option,
	or,
} from "@optique/core";
import { defineProgram } from "@optique/core/program";
import { generateManPage } from "@optique/man";
import { runSync } from "@optique/run";
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

const parser = or(
	object({
		noKeyring: option("--no-keyring", {
			description: message`Use alternative session.`,
		}),
	}),
	command("man", object({ man: constant(true) }), {
		brief: message`Show the manual.`,
	}),
);

const program = defineProgram({
	metadata: {
		name: "tiny-chat",
		brief: message`Tiny Chat in the terminal.`,
	},
	parser,
});

export type AppOptions = Exclude<InferValue<typeof parser>, { man: true }>;

export async function cli() {
	const parsed = runSync(program, {
		args: process.argv.slice(2),
		help: "both",
		version:
			workspace.version + (CommonUtils.isTruthy(process.env.DEV) ? "-dev" : ""),
	});
	if ("man" in parsed) {
		console.log("Generating man page...");
		console.log(generateManPage(program, { section: 1, date: new Date() }));
		console.log("Done!");
		return;
	}
	await main(parsed);
}
