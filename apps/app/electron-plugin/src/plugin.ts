import { homedir } from "node:os";
import type { ElectronPluginContext } from "@capawesome/capacitor-electron/plugin";
import {
	BrowserWindow,
	dialog,
	Menu,
	type MenuItemConstructorOptions,
	shell,
} from "electron";
import { AfmHostService } from "#app-electron-plugin/core/services/AfmHostService.ts";
import { ClaudeCodeHostService } from "#app-electron-plugin/core/services/ClaudeCodeHostService.ts";
import { CodexHostService } from "#app-electron-plugin/core/services/CodexHostService.ts";
import { CursorHostService } from "#app-electron-plugin/core/services/CursorHostService.ts";
import { McpHostService } from "#app-electron-plugin/core/services/McpHostService.ts";
import { ShellHostService } from "#app-electron-plugin/core/services/ShellHostService.ts";
import { UpdateHostService } from "#app-electron-plugin/core/services/UpdateHostService.ts";
import {
	DESKTOP_PLUGIN,
	type DesktopEvents,
	type DesktopHandlers,
	type DesktopMethods,
	type DesktopSend,
} from "#app-electron-plugin/core/types/plugin.ts";
import { ComputahHostService } from "#client/features/agent/services/ComputahHostService.ts";
import workspace from "../../../../package.json" with { type: "json" };

/** Every method, as the platform bridges only those it is told of. */
const methods = [
	"open",
	"pickFolder",
	"cwd",
	"tmpdir",
	"resolveDir",
	"locate",
	"readFile",
	"readFiles",
	"readDir",
	"walk",
	"writeFile",
	"rename",
	"remove",
	"spawn",
	"kill",
	"mcpStart",
	"mcpSend",
	"mcpSetProtocolVersion",
	"mcpClose",
	"afmAvailability",
	"afmStream",
	"afmCancel",
	"claudeCode",
	"codex",
	"cursor",
	"cursorSignIn",
	"computah",
	"computahAbort",
	"updateCheck",
	"updateInstall",
] as const satisfies (keyof DesktopMethods)[];

// Fails to compile when a method is missing from the list.
type Missing = Exclude<keyof DesktopMethods, (typeof methods)[number]>;
const complete: [Missing] extends [never] ? true : Missing = true;
void complete;

/**
 * The desktop app's main process, as the `Desktop` plugin's Electron
 * implementation: `@capawesome/capacitor-electron` creates it once, before
 * the first window, and bridges `methods` to the webview's `registerPlugin`.
 */
class DesktopImpl {
	constructor(context: ElectronPluginContext) {
		const send = new Proxy({} as DesktopSend, {
			get: (_, event: keyof DesktopEvents) => (payload: unknown) =>
				context.notifyListeners(event, payload),
		});

		// The browser, terminal and computer the agent drives, for the webview.
		// The process's own directory is inside the app bundle, so a terminal
		// starts at home, as the webview's shell does (`ShellHostService`).
		const computah = ComputahHostService.serve({
			computah: ComputahHostService.create({ cwd: homedir() }),
			onProgress: (payload) => send.computahProgress(payload),
		});

		const handlers: DesktopHandlers<(typeof methods)[number]> = {
			open: async ({ url }) => {
				await shell.openExternal(url);
			},
			pickFolder: async ({ defaultPath }) => {
				const options: Electron.OpenDialogOptions = {
					defaultPath: defaultPath ?? homedir(),
					properties: ["openDirectory", "createDirectory"],
				};
				const window = BrowserWindow.getFocusedWindow();
				const { canceled, filePaths } = window
					? await dialog.showOpenDialog(window, options)
					: await dialog.showOpenDialog(options);
				return (!canceled && filePaths[0]) || null;
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
		};
		Object.assign(this, handlers);

		Menu.setApplicationMenu(
			DesktopImpl.menu({ newChat: () => send.newChat(undefined) }),
		);
	}

	/** The platform's menus, with the app's own items among them. */
	private static menu({ newChat }: { newChat: () => void }) {
		const mac = process.platform === "darwin";
		const template: MenuItemConstructorOptions[] = [
			...(mac ? [{ role: "appMenu" } as const] : []),
			{
				label: "File",
				submenu: [
					{ label: "New Chat", accelerator: "CmdOrCtrl+N", click: newChat },
					{ type: "separator" },
					mac ? { role: "close" } : { role: "quit" },
				],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
			{
				role: "help",
				submenu: [
					...(mac ? [] : [{ role: "about" } as const]),
					{
						label: "Report Issue",
						click: () => void shell.openExternal(workspace.bugs.url),
					},
				],
			},
		];
		return Menu.buildFromTemplate(template);
	}
}

/** The platform's discovery contract, without a runtime dependency on it. */
Object.defineProperty(DesktopImpl, "__capacitorElectronPlugin", {
	value: { name: DESKTOP_PLUGIN, methods },
});

export { DesktopImpl as Desktop };
