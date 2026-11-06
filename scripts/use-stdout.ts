import * as readline from "node:readline";
import { inspect } from "node:util";
import { log } from "@ryangarber/utils";

type ExitHandler = (isCtrlD: boolean) => boolean;
let exitHandler: ExitHandler | undefined;

export function setExitHandler(value: ExitHandler) {
	setupTerminal();
	exitHandler = value;
}

export function setPassthrough(value: boolean) {
	process.stdin.setRawMode?.(!value);
	if (value) process.stdin.pause();
	else process.stdin.resume();
}

let terminalConfigured = false;

// Logging alone must not take over stdin or bypass a caller's signal cleanup.
// Only the interactive CLI opts into raw key handling via setExitHandler.
function setupTerminal() {
	if (!process.stdin.isTTY || terminalConfigured) return;
	terminalConfigured = true;
	readline.emitKeypressEvents(process.stdin);
	process.stdin.setRawMode(true);
	process.stdout.write(`\u001B[?25l`, () => {});
	const cleanup = ({ code }: { code: number }) => {
		log({ message: `Stopping...`, details: String(code) });
		process.stdout.write(`\u001B[?25h`, () => {});
	};
	process.on("exit", (code) => cleanup({ code }));
	process.on("uncaughtException", (data) => {
		log({
			message: "uncaught exception",
			details: inspect(data),
			level: "error",
		});
		process.exit(1);
	});
	process.on("unhandledRejection", (data) => {
		log({
			message: "unhandled rejection",
			details: inspect(data),
			level: "error",
		});
		process.exit(1);
	});
	process.on("SIGINT", () => {
		log({ message: "interrupted", level: "error" });
		process.exit(1);
	});
	process.stdin.on("keypress", (_input: string, key?: readline.Key) => {
		if (key?.ctrl && (key?.name === "c" || key?.name === "d")) {
			if (!exitHandler?.(key.name === "d")) {
				process.exit(0);
			}
		}
	});
}
