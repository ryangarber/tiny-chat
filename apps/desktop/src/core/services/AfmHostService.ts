import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PATHS } from "electrobun/main";
import type { AFMEvent } from "#core/features/provider/types/afm.ts";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

/**
 * Where `build.copy` puts `afmize-host`, when the build could make it: afmize
 * behind JSON lines on stdio. It runs apart from the main process because
 * Bun's thread-safe FFI callbacks drop afmize's events inside the Worker
 * Electrobun runs the main process in.
 */
const HOST = join(PATHS.VIEWS_FOLDER, "..", "native", "afmize-host");

type Reply =
	| { op: "availability"; json: string }
	| { op: "event"; id: number; event: string };

interface Host {
	child: ChildProcessWithoutNullStreams;
	availability: Promise<string>;
	listeners: Map<number, (event: AFMEvent) => void>;
}

export const AfmHostService = {
	/**
	 * Apple Foundation Models through afmize, on a Mac whose build carries it.
	 * The provider itself runs in the webview over these calls.
	 */
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<"afmAvailability" | "afmStream" | "afmCancel"> => {
		let host: Promise<Host | null> | undefined;
		let next = 1;

		const start = () =>
			(host ??= new Promise<Host | null>((resolve) => {
				if (process.platform !== "darwin" || !existsSync(HOST)) {
					return resolve(null);
				}

				// Fails to start on a macOS too old for FoundationModels, which only
				// leaves AFM out.
				const child = spawn(HOST, [], { stdio: ["pipe", "pipe", "pipe"] });
				const listeners = new Map<number, (event: AFMEvent) => void>();
				let onAvailability: (json: string) => void = () => {};
				const availability = new Promise<string>((done) => {
					onAvailability = done;
				});

				createInterface({ input: child.stdout }).on("line", (line) => {
					const reply = JSON.parse(line) as Reply;
					if (reply.op === "availability") return onAvailability(reply.json);
					const event = JSON.parse(reply.event) as AFMEvent;
					listeners.get(reply.id)?.(event);
					if (event.type === "finish") listeners.delete(reply.id);
				});
				child.stderr.on("data", (chunk) =>
					console.warn("[afm]", String(chunk)),
				);

				child.once("spawn", () => {
					child.stdin.write(`${JSON.stringify({ op: "availability" })}\n`);
					resolve({ child, availability, listeners });
				});
				child.once("error", (error) => {
					console.warn("[afm] failed to start afmize-host", error);
					onAvailability("{}");
					resolve(null);
				});
				// Started again on the next call, should it ever stop; its streams
				// end here, since it cannot finish them.
				child.once("exit", () => {
					host = undefined;
					onAvailability("{}");
					for (const listener of listeners.values()) {
						listener({ type: "finish", finishReason: "error" });
					}
				});
			}));

		const write = (afm: Host, command: object) =>
			afm.child.stdin.write(`${JSON.stringify(command)}\n`);

		const required = async () => {
			const afm = await start();
			if (!afm) throw new Error("Apple Foundation Models are unavailable");
			return afm;
		};

		return {
			afmAvailability: async () => {
				const afm = await start();
				return afm ? await afm.availability : null;
			},
			afmStream: async ({ key, request }) => {
				const afm = await required();
				const id = next++;
				afm.listeners.set(id, (event) => send.afmEvent({ key, event }));
				write(afm, { op: "stream", id, request: JSON.stringify(request) });
				return id;
			},
			afmCancel: async ({ id }) => {
				write(await required(), { op: "cancel", id });
			},
		};
	},
} as const;
