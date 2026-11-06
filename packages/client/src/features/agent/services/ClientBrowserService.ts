import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { z } from "zod";
import type { Client } from "#client/client.ts";
import { BrowserDriverUtils } from "#client/features/agent/utils/BrowserDriverUtils.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	zBrowserRunResult,
	zBrowserStatus,
	zBrowserStep,
} from "#core/features/tool/types/browser.ts";

export const zBrowserSettings = z.object({
	/** Show the browser window rather than run it headless. */
	headed: z.boolean().default(false),
});
export type zBrowserSettings = z.infer<typeof zBrowserSettings>;

export interface BrowserTab {
	index: number;
	url: string;
	title: string;
	active: boolean;
}

const SETTINGS_KEY = "browser";

/** Where `useBrowser` keeps the status, so a run that learns more can update it. */
export const browserStatusQueryKey = ["useBrowser", "status"] as const;

/**
 * A GUI app's PATH rarely has the user's Node on it (nvm, Homebrew), so it is
 * looked up the way the user's own terminal would find it.
 */
const NODE_LOOKUP = [
	"command -v node",
	`"\${SHELL:-/bin/sh}" -lc 'command -v node' </dev/null`,
	`"\${SHELL:-/bin/sh}" -ic 'command -v node' </dev/null`,
]
	.map((command) => `${command} 2>/dev/null`)
	.join(" || ");

interface Driver {
	transport: Transport;
	pending: Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>;
	next: number;
}

/** Per client: one driver process, and what was found to drive a browser. */
const drivers = new WeakMap<Client, Promise<Driver>>();
const statuses = new WeakMap<Client, Promise<zBrowserStatus>>();

const unavailable = (
	error: string,
	rest: Partial<zBrowserStatus> = {},
): zBrowserStatus => ({ available: false, error, browsers: [], ...rest });

const findNode = async (client: Client) => {
	const shell = client.shell;
	if (!shell) return null;
	// The driver runs on the host, so it needs the host's own node: on Windows
	// that is the one `where` finds, which still answers from inside WSL.
	const { stdout } =
		shell.environment?.().os === "windows" && shell.run
			? await shell.run({ program: "where.exe", args: ["node"] })
			: await shell.exec({ command: NODE_LOOKUP });
	// the last path printed: an interactive shell may print other things first
	const paths = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^(?:\/|[A-Za-z]:\\)/.test(line));
	return paths.at(-1) ?? null;
};

const start = async (client: Client, node: string): Promise<Driver> => {
	const createStdio = client.transports?.createStdio;
	if (!createStdio) throw new Error("This runtime cannot start processes");

	const transport = createStdio({
		// unique, so a driver still exiting cannot answer for its replacement
		name: `tiny-chat-browser-${CommonUtils.getRandomId()}`,
		command: [node, "-e", BrowserDriverUtils.script],
		env: { NODE_NO_WARNINGS: "1" },
	});
	const driver: Driver = { transport, pending: new Map(), next: 1 };

	transport.onmessage = (message: JSONRPCMessage) => {
		if (!("id" in message) || typeof message.id !== "number") return;
		const request = driver.pending.get(message.id);
		if (!request) return;
		driver.pending.delete(message.id);
		if ("error" in message) request.reject(new Error(message.error.message));
		else if ("result" in message) request.resolve(message.result);
	};
	transport.onerror = (error) => {
		console.warn("[ClientBrowserService] driver error:", error);
	};
	transport.onclose = () => {
		for (const request of driver.pending.values()) {
			request.reject(new Error("The browser driver exited"));
		}
		driver.pending.clear();
		void drivers.get(client)?.then((current) => {
			if (current === driver) drivers.delete(client);
		});
	};

	await transport.start();
	return driver;
};

const getDriver = (client: Client, node: string) => {
	let driver = drivers.get(client);
	if (!driver) {
		driver = start(client, node);
		drivers.set(client, driver);
		driver.catch(() => drivers.delete(client));
	}
	return driver;
};

const request = async <T>(
	driver: Driver,
	method: string,
	params: Record<string, unknown>,
	abort?: AbortSignal,
): Promise<T> => {
	abort?.throwIfAborted();
	const id = driver.next++;
	const result = new Promise<T>((resolve, reject) => {
		driver.pending.set(id, {
			resolve: resolve as (value: unknown) => void,
			reject,
		});
	});

	const onAbort = () => {
		// The driver stops before its next step; the call is over now.
		void driver.transport.send({
			jsonrpc: "2.0",
			method: "abort",
			params: { id },
		});
		driver.pending.get(id)?.reject(new Error("Aborted"));
		driver.pending.delete(id);
	};
	abort?.addEventListener("abort", onAbort, { once: true });

	try {
		await driver.transport.send({ jsonrpc: "2.0", id, method, params });
		return await result;
	} finally {
		abort?.removeEventListener("abort", onAbort);
	}
};

const detect = async (client: Client): Promise<zBrowserStatus> => {
	if (!client.shell || !client.transports?.createStdio) {
		return unavailable("Browser automation needs the desktop app or the CLI.");
	}

	const node = await findNode(client).catch(() => null);
	if (!node) {
		return unavailable(
			"Node.js was not found. Install it to use Playwright, then recheck.",
		);
	}

	const driver = await getDriver(client, node);
	return await request<zBrowserStatus>(driver, "detect", {
		cwd: await client.shell.cwd?.(),
	});
};

export const ClientBrowserService = {
	/** Found once per client, then cached until `recheck`. */
	getStatus: ({ client }: { client: Client }): Promise<zBrowserStatus> => {
		let status = statuses.get(client);
		if (!status) {
			status = detect(client).catch((error: unknown) =>
				unavailable(error instanceof Error ? error.message : String(error)),
			);
			statuses.set(client, status);
		}
		return status;
	},

	/** Closes the browser and its driver, and looks again. */
	recheck: async ({ client }: { client: Client }) => {
		await ClientBrowserService.close({ client });
		statuses.delete(client);
		return await ClientBrowserService.getStatus({ client });
	},

	close: async ({ client }: { client: Client }) => {
		const driver = await drivers.get(client)?.catch(() => null);
		drivers.delete(client);
		if (!driver) return;
		await request(driver, "close", {}).catch(() => {});
		await driver.transport.close().catch(() => {});
	},

	run: async ({
		client,
		steps,
		screenshot,
		abort,
	}: {
		client: Client;
		steps: zBrowserStep[];
		screenshot?: boolean;
		abort?: AbortSignal;
	}): Promise<zBrowserRunResult> => {
		const status = await ClientBrowserService.getStatus({ client });
		if (!status.available || !status.node || !status.playwright) {
			throw new Error(status.error ?? "No browser is available");
		}
		const browser = status.browser ?? status.browsers[0];
		if (!browser) throw new Error("No browser is available");

		const settings = ClientBrowserService.getSettings({ client });
		const driver = await getDriver(client, status.node.path);
		const result = await request<zBrowserRunResult>(
			driver,
			"run",
			{
				steps,
				screenshot,
				playwright: status.playwright.path,
				executablePath: browser.path,
				headless: !settings.headed,
			},
			abort,
		);

		// A headed launch that found no desktop is only learned by trying, so
		// the status shown beside the setting is brought up to date with it.
		if (
			settings.headed &&
			result.notice &&
			status.display?.available !== false
		) {
			const display = await request<zBrowserStatus>(driver, "detect", {
				cwd: await client.shell?.cwd?.(),
			})
				.then((found) => found.display)
				.catch(() => undefined);
			if (display) {
				const updated = { ...status, display };
				statuses.set(client, Promise.resolve(updated));
				client.queryClient.setQueryData(browserStatusQueryKey, updated);
			}
		}
		return result;
	},

	/**
	 * The tabs open in the browser the agent drives, to attach one. Only asks a
	 * driver already running, so it never starts one or a browser.
	 */
	getTabs: async ({ client }: { client: Client }): Promise<BrowserTab[]> => {
		const driver = await drivers.get(client)?.catch(() => null);
		if (!driver) return [];
		const { tabs } = await request<{ tabs: BrowserTab[] }>(
			driver,
			"listTabs",
			{},
		);
		return tabs;
	},

	/** One tab as its rendered text, without switching to it. */
	readTab: async ({
		client,
		tab,
	}: {
		client: Client;
		tab: number;
	}): Promise<{ url: string; title: string; text: string }> => {
		const driver = await drivers.get(client)?.catch(() => null);
		if (!driver) throw new Error("The browser is not running");
		return await request(driver, "readTab", { index: tab });
	},

	/** Local to this machine, so kept in the runtime's storage, not on the user. */
	getSettings: ({ client }: { client: Client }): zBrowserSettings => {
		const parsed = zBrowserSettings.safeParse(
			client.getStorage(SETTINGS_KEY) ?? {},
		);
		return parsed.success ? parsed.data : zBrowserSettings.parse({});
	},

	setSettings: ({
		client,
		settings,
	}: {
		client: Client;
		settings: zBrowserSettings;
	}) => {
		client.setStorage(SETTINGS_KEY, settings);
	},
} as const;
