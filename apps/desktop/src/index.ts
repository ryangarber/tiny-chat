import { homedir } from "node:os";
import { Driver } from "computah";
import Electrobun, {
	BrowserView,
	BrowserWindow,
	type ElectrobunEvent,
	Updater,
	Utils,
} from "electrobun/main";
import { createMenu, standardMenu } from "electrobun-menu";
import { ComputahHostService } from "#client/features/agent/services/ComputahHostService.ts";
import { AfmHostService } from "#desktop/core/services/AfmHostService.ts";
import { ClaudeCodeHostService } from "#desktop/core/services/ClaudeCodeHostService.ts";
import { CodexHostService } from "#desktop/core/services/CodexHostService.ts";
import { CursorHostService } from "#desktop/core/services/CursorHostService.ts";
import { McpHostService } from "#desktop/core/services/McpHostService.ts";
import { ShellHostService } from "#desktop/core/services/ShellHostService.ts";
import { UpdateHostService } from "#desktop/core/services/UpdateHostService.ts";
import type { DesktopRPC, DesktopSend } from "#desktop/core/types/rpc.ts";
import workspace from "../../../package.json" with { type: "json" };
import config from "../electrobun.config.ts";

/**
 * The GUI's Vite server, for a dev build run by `scripts/dev.ts` with HMR;
 * set at build time by `electrobun.config.ts`. Otherwise the GUI is the build
 * copied into the app.
 */
const DEV_URL = process.env.DESKTOP_DEV_URL;

const url =
	DEV_URL && (await Updater.localInfo.channel()) === "dev"
		? DEV_URL
		: "views://main/index.html";

const send: DesktopSend = new Proxy({} as DesktopSend, {
	get: (_, message: keyof DesktopSend) => (payload: never) =>
		(rpc.send[message] as (payload: never) => void)(payload),
});

// The browser, terminal and computer the agent drives, for the webview. The
// computer's embedded driver runs for this app, under its own grants. The
// process's own directory is inside the app bundle (and stays there, since
// Electrobun reads its files relative to it), so a terminal starts at home,
// as the webview's shell does (`ShellHostService`).
const computah = ComputahHostService.serve({
	computah: ComputahHostService.create({
		bundleId: config.app.identifier,
		cwd: homedir(),
	}),
	onProgress: (payload) => send.computahProgress(payload),
});

// Every quit, a native one included, asks first. The embedded driver would
// otherwise outlive the app: Electrobun's quit never fires Node's `exit`.
Electrobun.events.on("before-quit", () => Driver.killEmbedded());

/** The URL the app was opened with, until the webview takes it. */
let openUrl: string | null = null;

const rpc = BrowserView.defineRPC<DesktopRPC>({
	// Commands, model streams and updates run as long as they take; each side
	// stops them itself.
	maxRequestTime: Number.POSITIVE_INFINITY,
	handlers: {
		requests: {
			open: async ({ url }) => {
				Utils.openExternal(url);
			},
			pickFolder: async ({ defaultPath }) => {
				const [path] = await Utils.openFileDialog({
					startingFolder: defaultPath ?? "~",
					canChooseFiles: false,
					canChooseDirectory: true,
					allowsMultipleSelection: false,
				});
				return path || null;
			},
			...ShellHostService.create({ send }),
			...McpHostService.create({ send }),
			...AfmHostService.create({ send }),
			...ClaudeCodeHostService.create({ send }),
			...CodexHostService.create({ send }),
			...CursorHostService.create({ send }),
			...UpdateHostService.create({ send }),
			computah: (request) => computah.call(request),
			computahAbort: (request) => computah.abort(request),
			quit: async () => {
				Utils.quit();
			},
			takeOpenUrl: async () => {
				const url = openUrl;
				openUrl = null;
				return url;
			},
		},
		messages: {},
	},
});

const menu = createMenu(
	Electrobun,
	standardMenu({
		appName: config.app.name,
		version: config.app.version,
		file: [
			{
				label: "New Chat",
				action: "new-chat",
				accelerator: "CmdOrCtrl+N",
			},
		],
		help: [
			{
				label: "Report Issue",
				action: "report-issue",
			},
		],
	}),
);

menu.on("application-menu-clicked", ({ data }) => {
	if (data?.action === "new-chat") {
		send.newChat(undefined);
	}
	if (data?.action === "report-issue") {
		Utils.openExternal(workspace.bugs.url);
	}
});

const mainWindow = new BrowserWindow({
	title: "Tiny Chat",
	url,
	frame: { width: 1280, height: 720 },
	rpc,
});

menu.attach(mainWindow);

// `tinychat://`, as a sign-in in the browser returns to the app (macOS only,
// and only once the app is in /Applications). Kept for a webview that isn't
// listening yet, as when the URL launched the app.
Electrobun.events.on("open-url", (event: unknown) => {
	const { data } = event as ElectrobunEvent<{ url: string }, void>;
	openUrl = data.url;
	send.openUrl({ url: data.url });
	mainWindow.activate();
});
