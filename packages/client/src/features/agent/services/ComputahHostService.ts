import {
	type Computer,
	type ComputerOptions,
	type ComputerStatus,
	createBrowser,
	createComputer,
	createTerminal,
	Driver,
	type DriverChoice,
	type InstallProgress,
} from "computah";
import {
	type ClientComputah,
	COMPUTAH_METHODS,
	type ComputahRequest,
} from "#client/features/agent/types/computah.ts";
import type { ComputerCapability } from "#core/core/types/capability.ts";

/** What the virtual cursor wears as its badge. */
const SESSION = "Tiny Chat";

/**
 * The driver for the computer, chosen so there is always an on-screen cursor
 * where one can be had: the Cua Driver app's service where it is reachable
 * and already permitted (its own grants), else its `cua-driver` binary run as
 * this process's child (`embedded`: this app's grants, still with the
 * cursor). Only with no driver installed at all is it the in-process one,
 * which has no cursor on macOS; the status then says it can be installed.
 */
const chooseDriver = async ({
	bundleId,
}: {
	bundleId?: string;
}): Promise<DriverChoice> => {
	const { sdk } = await Driver.load();
	// Its status says why it cannot load.
	if (!sdk) return "in-process";
	const found = Driver.discover();
	if (found.app) {
		const service = await Driver.app({
			sdk,
			app: found.app,
			session: SESSION,
		}).catch(() => undefined);
		if (service) {
			const grants = await Driver.permissions(service).catch(() => undefined);
			await service.close().catch(() => {});
			if (grants?.accessibility && grants.screenRecording) return "app";
		}
	}
	return found.cli
		? { binaryPath: found.cli, ...(bundleId ? { bundleId } : {}) }
		: "in-process";
};

/**
 * One computer for the life of the host, whose driver is chosen again
 * whenever what it was chosen from may have changed: a refresh, an install,
 * a grant.
 */
const createHostComputer = (
	options: Omit<ComputerOptions, "driver"> & { bundleId?: string },
): ComputerCapability => {
	let current: Promise<Computer> | undefined;

	const start = async () => {
		const driver = await chooseDriver(options);
		const computer = createComputer({ ...options, session: SESSION, driver });
		if (typeof driver !== "object") return computer;
		// A binary that will not start is no reason to have no computer at all.
		const status = await computer.status();
		if (status.mode) return computer;
		console.warn("[ComputahHostService] embedded driver failed:", status.error);
		await computer.close().catch(() => {});
		return createComputer({
			...options,
			session: SESSION,
			driver: "in-process",
		});
	};

	const get = () => {
		if (!current) {
			const starting = start();
			current = starting;
			starting.catch(() => {
				if (current === starting) current = undefined;
			});
		}
		return current;
	};

	const reset = async () => {
		const previous = current;
		current = undefined;
		await (await previous?.catch(() => undefined))?.close().catch(() => {});
	};

	return {
		status: async (input): Promise<ComputerStatus> => {
			if (input?.refresh) await reset();
			return await (await get()).status();
		},
		install: async (input) => {
			const result = await (await get()).install({
				onProgress: input?.onProgress,
				signal: input?.abort,
			});
			// What the driver was chosen from has changed.
			if (result.ok) await reset();
			return result;
		},
		permissions: async () => await (await get()).permissions(),
		requestPermissions: async (input) => {
			const permissions = await (await get()).requestPermissions(input);
			await reset();
			return permissions;
		},
		run: async ({ abort, ...input }) =>
			await (await get()).run({ ...input, signal: abort }),
		windows: async (input) => await (await get()).windows(input),
	};
};

/**
 * computah's controllers for runtimes with Node's APIs: the CLI holds them
 * itself, and the desktop app's main process holds them for its webview,
 * which reaches them through {@link ComputahHostService.serve}. Each is one
 * object for the life of the host, so a browser's tabs, a terminal's sessions
 * and the computer's target window carry over between messages.
 */
export const ComputahHostService = {
	create: ({
		bundleId,
		cwd,
	}: {
		/** The host app's bundle, which the computer's embedded driver runs for. */
		bundleId?: string;
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
			computer: createHostComputer({ bundleId }),
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
