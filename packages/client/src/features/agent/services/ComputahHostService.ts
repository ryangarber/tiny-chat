import {
	createBrowser,
	createComputer,
	createTerminal,
	type InstallProgress,
} from "computah";
import {
	type ClientComputah,
	COMPUTAH_METHODS,
	type ComputahRequest,
} from "#client/features/agent/types/computah.ts";

/** What the virtual cursor wears as its badge. */
const SESSION = "Tiny Chat";

/**
 * computah's controllers for runtimes with Node's APIs: the CLI holds them
 * itself, and the desktop app's main process holds them for its webview,
 * which reaches them through {@link ComputahHostService.serve}. Each is one
 * object for the life of the host, so a browser's tabs, a terminal's sessions
 * and the computer's target window carry over between messages.
 */
export const ComputahHostService = {
	create: ({
		cwd,
	}: {
		/**
		 * Where a terminal session starts that names no directory of its own;
		 * the process's by default. An app started from Finder or the Dock sits
		 * inside its own bundle, so it passes somewhere better.
		 */
		cwd?: string;
	} = {}): ClientComputah => {
		// The user's choice, as the last run passed it; read as the browser launches.
		let headless = true;
		const browser = createBrowser({ headless: () => headless });
		const terminal = createTerminal(cwd ? { cwd } : {});
		// The Cua Driver app's service where it is installed and permitted (it
		// draws the on-screen cursor), else a driver in this process, which on
		// macOS has none. computah chooses again after a refresh, an install
		// or a grant.
		const computer = createComputer({ session: SESSION, driver: "auto" });

		return {
			browser: {
				status: (input) => browser.status(input),
				install: (input) =>
					browser.install({
						onProgress: input?.onProgress,
						signal: input?.abort,
					}),
				permissions: () => browser.permissions(),
				requestPermissions: () => browser.requestPermissions(),
				run: ({ headless: next, abort, ...input }) => {
					if (next !== undefined) headless = next;
					return browser.run({ ...input, signal: abort });
				},
				tabs: () => browser.tabs(),
				readTab: ({ index, maxLength }) =>
					browser.readTab(index, { maxLength }),
			},
			terminal: {
				status: (input) => terminal.status(input),
				install: (input) =>
					terminal.install({
						onProgress: input?.onProgress,
						signal: input?.abort,
					}),
				permissions: () => terminal.permissions(),
				requestPermissions: () => terminal.requestPermissions(),
				run: ({ abort, ...input }) => terminal.run({ ...input, signal: abort }),
				touchesForeign: (input) => terminal.touchesForeign(input),
			},
			computer: {
				status: (input) => computer.status(input),
				install: (input) =>
					computer.install({
						onProgress: input?.onProgress,
						signal: input?.abort,
					}),
				permissions: () => computer.permissions(),
				requestPermissions: (input) => computer.requestPermissions(input),
				run: ({ abort, ...input }) => computer.run({ ...input, signal: abort }),
				windows: (input) => computer.windows(input),
			},
		};
	},

	/**
	 * Answers a remote caller's requests (`ComputahRemoteService`): one method
	 * of one surface per request, aborted by its id, with install progress
	 * sent back under it.
	 */
	serve: ({
		computah,
		onProgress,
	}: {
		computah: ClientComputah;
		onProgress: (_: { id: string; progress: InstallProgress }) => void;
	}) => {
		const running = new Map<string, AbortController>();

		return {
			call: async ({ id, surface, method, input }: ComputahRequest) => {
				const methods: readonly string[] = COMPUTAH_METHODS[surface] ?? [];
				if (!methods.includes(method)) {
					throw new Error(`Unknown computah method: ${surface}.${method}`);
				}
				const controller = new AbortController();
				running.set(id, controller);
				try {
					const target = computah[surface] as unknown as Record<
						string,
						(input: unknown) => Promise<unknown>
					>;
					return await target[method]?.({
						...(input && typeof input === "object" ? input : {}),
						abort: controller.signal,
						onProgress: (progress: InstallProgress) =>
							onProgress({ id, progress }),
					});
				} finally {
					running.delete(id);
				}
			},
			abort: async ({ id }: { id: string }) => {
				running.get(id)?.abort();
			},
		};
	},
} as const;
