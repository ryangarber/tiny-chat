import {
	type AfmEvent,
	type AfmizeClient,
	createEventStream,
} from "@afmize/node";
import { registerPlugin } from "@capacitor/core";
import type {
	JSONRPCMessage,
	Transport,
	TransportSendOptions,
} from "@modelcontextprotocol/client";
import {
	type ClaudeCodeChannelMessage,
	connectClaudeCodeHost,
} from "@ryangarber/ai-sdk-providers/claude";
import {
	type CodexChannelMessage,
	connectCodexHost,
} from "@ryangarber/ai-sdk-providers/codex";
import {
	type CursorChannelMessage,
	connectCursorHost,
} from "@ryangarber/ai-sdk-providers/cursor";
import type { InstallProgress } from "computah/schema";
import {
	DESKTOP_PLUGIN,
	type DesktopPlugin,
	type McpServer,
} from "#app-electron-plugin/core/types/plugin.ts";
import { ComputahRemoteService } from "#client/features/agent/services/ComputahRemoteService.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { LaunchRemoteService } from "#client/features/launch/services/LaunchRemoteService.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { createAFMProvider } from "#core/features/provider/providers/model/AFMProvider.ts";
import { createClaudeCodeProvider } from "#core/features/provider/providers/model/ClaudeCodeProvider.ts";
import { createCodexProvider } from "#core/features/provider/providers/model/CodexProvider.ts";
import { createCursorProvider } from "#core/features/provider/providers/model/CursorProvider.ts";
import type { ClientRuntime } from "#gui/core/types/runtime.ts";

/** Listeners for what the main process sends, by the id it is sent under. */
const spawnListeners = new Map<
	string,
	(output: { type: "stdout" | "stderr"; value: string }) => void
>();
const mcpTransports = new Map<string, PluginTransport>();
const afmListeners = new Map<number, (event: AfmEvent) => void>();
let nextAfmKey = 1;
/** Who listens for what the main process's Claude Code host sends. */
const claudeCodeListeners = new Set<
	(message: ClaudeCodeChannelMessage) => void
>();
/** Who listens for what the main process's Codex and Cursor hosts send. */
const codexListeners = new Set<(message: CodexChannelMessage) => void>();
const cursorListeners = new Set<(message: CursorChannelMessage) => void>();
let updateListener: ((fraction: number) => void) | undefined;
/** Install progress from the main process's computah, for the call it belongs to. */
let computahProgress:
	| ((_: { id: string; progress: InstallProgress }) => void)
	| undefined;

/**
 * Connects to the main process: the `Desktop` plugin's Electron
 * implementation (`plugin.ts`). Its events are listened for before any
 * method is called, so none is missed.
 */
function connect(): DesktopPlugin {
	const desktop = registerPlugin<DesktopPlugin>(DESKTOP_PLUGIN);
	void desktop.addListener("newChat", () => ChatService.setChat({ id: null }));
	void desktop.addListener("spawnOutput", ({ id, ...output }) =>
		spawnListeners.get(id)?.(output),
	);
	void desktop.addListener("mcpMessage", ({ id, message }) =>
		mcpTransports.get(id)?.onmessage?.(message),
	);
	void desktop.addListener("mcpStderr", ({ id, text }) =>
		mcpTransports.get(id)?.onStderr?.(text),
	);
	void desktop.addListener("mcpError", ({ id, message }) =>
		mcpTransports.get(id)?.onerror?.(new Error(message)),
	);
	void desktop.addListener("mcpClose", ({ id }) => {
		const transport = mcpTransports.get(id);
		mcpTransports.delete(id);
		transport?.onclose?.();
	});
	void desktop.addListener("afmEvent", ({ key, event }) => {
		afmListeners.get(key)?.(event);
		if (event.type === "finish") afmListeners.delete(key);
	});
	void desktop.addListener("claudeCode", (message) => {
		for (const listener of claudeCodeListeners) listener(message);
	});
	void desktop.addListener("codex", (message) => {
		for (const listener of codexListeners) listener(message);
	});
	void desktop.addListener("cursor", (message) => {
		for (const listener of cursorListeners) listener(message);
	});
	void desktop.addListener("computahProgress", (payload) =>
		computahProgress?.(payload),
	);
	void desktop.addListener("updateProgress", ({ fraction }) =>
		updateListener?.(fraction),
	);
	return desktop;
}

/** The OS the webview runs on; Electron's Chromium reports it as a browser's would. */
function getPlatform(): "macos" | "windows" | "linux" {
	const platform = navigator.platform.toLowerCase();
	if (platform.startsWith("mac")) return "macos";
	if (platform.startsWith("win")) return "windows";
	return "linux";
}

/** An MCP transport running in the main process (`McpHostService`). */
class PluginTransport implements Transport {
	readonly id = CommonUtils.getRandomId();
	onmessage?: (message: JSONRPCMessage) => void;
	onerror?: (error: Error) => void;
	onclose?: () => void;

	constructor(
		private readonly desktop: DesktopPlugin,
		private readonly server: McpServer,
		readonly onStderr?: (text: string) => void,
	) {}

	async start() {
		mcpTransports.set(this.id, this);
		try {
			await this.desktop.mcpStart({ ...this.server, id: this.id });
		} catch (error) {
			mcpTransports.delete(this.id);
			throw error;
		}
	}

	async send(message: JSONRPCMessage, options?: TransportSendOptions) {
		await this.desktop.mcpSend({
			id: this.id,
			message,
			relatedRequestId: options?.relatedRequestId,
		});
	}

	setProtocolVersion(version: string) {
		void this.desktop.mcpSetProtocolVersion({ id: this.id, version });
	}

	async close() {
		await this.desktop.mcpClose({ id: this.id });
	}
}

/** The desktop app's runtime over its main process. */
function create(desktop: DesktopPlugin): DesktopRuntime {
	// The browser, terminal and computer live in the main process.
	const remote = ComputahRemoteService.create({
		call: (request) => desktop.computah(request),
		abort: (request) => desktop.computahAbort(request),
	});
	computahProgress = remote.progress;

	// afmize runs in the main process (`AfmHostService`); this reaches it.
	const afmize: AfmizeClient = {
		availability: async () =>
			(await desktop.afmAvailability()) ?? {
				onDevice: { available: false, reason: "platform-not-supported" },
				privateCloudCompute: {
					available: false,
					reason: "platform-not-supported",
				},
			},
		stream: (request, options = {}) =>
			createEventStream(async (onEvent) => {
				const key = nextAfmKey++;
				afmListeners.set(key, onEvent);
				try {
					await desktop.afmStream({ key, request });
				} catch (error) {
					afmListeners.delete(key);
					throw error;
				}
				return () => desktop.afmCancel({ key });
			}, options.signal),
	};
	const AFMProvider = createAFMProvider(afmize);

	// Claude Code runs in the main process; the provider reaches its host
	// over one channel.
	const ClaudeCodeProvider = createClaudeCodeProvider(
		connectClaudeCodeHost({
			post: (message) => void desktop.claudeCode(message),
			listen: (handler) => {
				claudeCodeListeners.add(handler);
				return () => claudeCodeListeners.delete(handler);
			},
		}),
	);

	// Codex too, over a channel of its own.
	const CodexProvider = createCodexProvider(
		connectCodexHost({
			post: (message) => void desktop.codex(message),
			listen: (handler) => {
				codexListeners.add(handler);
				return () => codexListeners.delete(handler);
			},
		}),
	);

	const CursorProvider = createCursorProvider(
		connectCursorHost({
			post: (message) => void desktop.cursor(message),
			listen: (handler) => {
				cursorListeners.add(handler);
				return () => cursorListeners.delete(handler);
			},
		}),
		() => desktop.cursorSignIn(),
	);

	const platform = getPlatform();

	return {
		platform,
		open: (url) => desktop.open({ url }),
		pickFolder: (params) => desktop.pickFolder(params),
		getModelProviders: async () => [
			...(platform === "macos" && (await desktop.afmAvailability())
				? [AFMProvider]
				: []),
			ClaudeCodeProvider,
			CodexProvider,
			CursorProvider,
		],
		shell: {
			os: platform === "windows" || platform === "linux" ? platform : "macos",
			cwd: () => desktop.cwd(),
			tmpdir: () => desktop.tmpdir(),
			resolveDir: (params) => desktop.resolveDir(params),
			locate: (params) => desktop.locate(params),
			readFile: async (params) => {
				const file = await desktop.readFile(params);
				return { path: file.path, data: FileUtils.getBufferFromBytes(file) };
			},
			readFiles: async (params) =>
				(await desktop.readFiles(params)).map(
					(file) =>
						file && {
							data: FileUtils.getBufferFromBytes(file),
							size: file.size,
						},
				),
			readDir: (params) => desktop.readDir(params),
			walk: (params) => desktop.walk(params),
			writeFile: (params) => desktop.writeFile(params),
			rename: (params) => desktop.rename(params),
			remove: (params) => desktop.remove(params),
			// Output arrives while it runs; the resolved value still carries all of
			// it. It is stopped by the id it was started under.
			spawn: async ({ program, args, cwd, env, stream, abort }) => {
				abort?.throwIfAborted();
				const id = CommonUtils.getRandomId();
				const kill = () => void desktop.kill({ id });
				if (stream) spawnListeners.set(id, stream);
				abort?.addEventListener("abort", kill, { once: true });
				try {
					return await desktop.spawn({ id, program, args, cwd, env });
				} finally {
					spawnListeners.delete(id);
					abort?.removeEventListener("abort", kill);
				}
			},
		},
		transports: {
			createStdio: ({ name, command, env, onStderr }) =>
				new PluginTransport(
					desktop,
					{ type: "stdio", name, command, env },
					onStderr,
				),
			createStreamableHttp: ({ name, url, headers }) =>
				new PluginTransport(desktop, {
					type: "http",
					name,
					url: String(url),
					headers,
				}),
		},
		computah: remote.computah,
		launch: LaunchRemoteService.create({
			call: (request) => desktop.launch(request),
		}),
		update: {
			check: () => desktop.updateCheck(),
			install: async ({ onProgress }) => {
				updateListener = onProgress;
				try {
					await desktop.updateInstall();
				} finally {
					updateListener = undefined;
				}
			},
		},
	};
}

/**
 * What the desktop app's main process gives the GUI, over the `Desktop`
 * plugin: everything of a `ClientRuntime` but what `@capacitor/app` gives it
 * (`apps/app/src/client-runtime.ts`).
 */
export type DesktopRuntime = Omit<ClientRuntime, "auth" | "quit">;

export const DesktopRuntime = {
	/** Only inside the desktop app's webview, where the plugin is. */
	create: (): DesktopRuntime => create(connect()),
} as const;
