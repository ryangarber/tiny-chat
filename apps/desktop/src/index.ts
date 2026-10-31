import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	type ElectrobunEvent,
	Updater,
	Utils,
} from "electrobun/main";
import { ComputerHostService } from "#client/features/agent/services/ComputerHostService.ts";
import { AfmHostService } from "#desktop/core/services/AfmHostService.ts";
import { ClaudeCodeHostService } from "#desktop/core/services/ClaudeCodeHostService.ts";
import { McpHostService } from "#desktop/core/services/McpHostService.ts";
import { ShellHostService } from "#desktop/core/services/ShellHostService.ts";
import { UpdateHostService } from "#desktop/core/services/UpdateHostService.ts";
import type { DesktopRPC, DesktopSend } from "#desktop/core/types/rpc.ts";
import workspace from "../../../package.json" with { type: "json" };

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

const computer = ComputerHostService.create();

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
			...UpdateHostService.create({ send }),
			computerCall: (request) => computer.call(request),
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

const mainWindow = new BrowserWindow({
	title: "Tiny Chat",
	url,
	frame: { width: 1280, height: 720 },
	rpc,
});

// `tinychat://`, as a sign-in in the browser returns to the app (macOS only,
// and only once the app is in /Applications). Kept for a webview that isn't
// listening yet, as when the URL launched the app.
Electrobun.events.on("open-url", (event: unknown) => {
	const { data } = event as ElectrobunEvent<{ url: string }, void>;
	openUrl = data.url;
	send.openUrl({ url: data.url });
	mainWindow.activate();
});

ApplicationMenu.setApplicationMenu([
	{
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ role: "hide", accelerator: "CommandOrControl+H" },
			{ role: "hideOthers", accelerator: "CommandOrControl+Alt+H" },
			{ type: "separator" },
			{ role: "quit", accelerator: "CommandOrControl+Q" },
		],
	},
	{
		label: "File",
		submenu: [
			//{ label: "New Chat", action: "new-chat", accelerator: "CommandOrControl+N" },
			//{ type: "separator" },
			{ role: "close", accelerator: "CommandOrControl+W" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "pasteAndMatchStyle" },
			{ role: "delete" },
			{ role: "selectAll" },
		],
	},
	{
		label: "View",
		submenu: [{ role: "toggleFullScreen" }],
	},
	{
		label: "Window",
		submenu: [{ role: "minimize" }, { role: "zoom" }],
	},
	{
		label: "Help",
		submenu: [
			{
				label: "Report Issue",
				action: "report-issue",
				accelerator: "CommandOrControl+I",
			},
		],
	},
]);

type ApplicationMenuClickedEvent = ElectrobunEvent<
	{ id?: number; action: string; data?: unknown },
	{ allow: boolean }
>;
ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
	const { data } = event as ApplicationMenuClickedEvent;
	if (data?.action === "report-issue") {
		Utils.openExternal(workspace.bugs.url);
	}
});
