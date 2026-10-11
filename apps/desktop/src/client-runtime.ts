import type {
	JSONRPCMessage,
	Transport,
	TransportSendOptions,
} from "@modelcontextprotocol/client";
import { Electroview } from "electrobun/view";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { createAFMProvider } from "#core/features/provider/providers/model/AFMProvider.ts";
import type { AFMEvent } from "#core/features/provider/types/afm.ts";
import type { DesktopRPC, McpServer } from "#desktop/core/types/rpc.ts";
import type {
	ClientRuntime,
	RuntimePlatform,
} from "#gui/core/types/runtime.ts";
import { RuntimeUtils } from "#gui/core/utils/RuntimeUtils.ts";

type DesktopView = ReturnType<typeof Electroview.defineRPC<DesktopRPC>>;

/** Listeners for what the main process sends, by the id it is sent under. */
const spawnListeners = new Map<
	string,
	(output: { type: "stdout" | "stderr"; value: string }) => void
>();
const mcpTransports = new Map<string, RpcTransport>();
const afmListeners = new Map<number, (event: AFMEvent) => void>();
let nextAfmKey = 1;
let updateListener: ((fraction: number) => void) | undefined;

/** Connects to the main process; only inside an Electrobun webview. */
function connect(): DesktopView {
	const rpc = Electroview.defineRPC<DesktopRPC>({
		// Commands, model streams and updates run as long as they take; each side
		// stops them itself.
		maxRequestTime: Number.POSITIVE_INFINITY,
		handlers: {
			requests: {},
			messages: {
				spawnOutput: ({ id, ...output }) => spawnListeners.get(id)?.(output),
				mcpMessage: ({ id, message }) =>
					mcpTransports.get(id)?.onmessage?.(message),
				mcpStderr: ({ id, text }) => mcpTransports.get(id)?.onStderr?.(text),
				mcpError: ({ id, message }) =>
					mcpTransports.get(id)?.onerror?.(new Error(message)),
				mcpClose: ({ id }) => {
					const transport = mcpTransports.get(id);
					mcpTransports.delete(id);
					transport?.onclose?.();
				},
				afmEvent: ({ key, event }) => {
					afmListeners.get(key)?.(event);
					if (event.type === "finish") afmListeners.delete(key);
				},
				updateProgress: ({ fraction }) => updateListener?.(fraction),
			},
		},
	});
	new Electroview({ rpc });
	return rpc;
}

/** An MCP transport running in the main process (`McpHostService`). */
class RpcTransport implements Transport {
	readonly id = CommonUtils.getRandomId();
	onmessage?: (message: JSONRPCMessage) => void;
	onerror?: (error: Error) => void;
	onclose?: () => void;

	constructor(
		private readonly rpc: DesktopView,
		private readonly server: McpServer,
		readonly onStderr?: (text: string) => void,
	) {}

	async start() {
		mcpTransports.set(this.id, this);
		try {
			await this.rpc.request.mcpStart({ ...this.server, id: this.id });
		} catch (error) {
			mcpTransports.delete(this.id);
			throw error;
		}
	}

	async send(message: JSONRPCMessage, options?: TransportSendOptions) {
		await this.rpc.request.mcpSend({
			id: this.id,
			message,
			relatedRequestId: options?.relatedRequestId,
		});
	}

	setProtocolVersion(version: string) {
		void this.rpc.request.mcpSetProtocolVersion({ id: this.id, version });
	}

	async close() {
		await this.rpc.request.mcpClose({ id: this.id });
	}
}

/** The desktop app's runtime over its main process. */
function create(rpc: DesktopView): ClientRuntime {
	const AFMProvider = createAFMProvider({
		availability: async () => (await rpc.request.afmAvailability()) ?? "{}",
		stream: async (request, onEvent) => {
			const key = nextAfmKey++;
			afmListeners.set(key, onEvent);
			try {
				return await rpc.request.afmStream({ key, request });
			} catch (error) {
				afmListeners.delete(key);
				throw error;
			}
		},
		cancel: async (id) => {
			await rpc.request.afmCancel({ id });
		},
	});

	const platform = window.__electrobunPlatform as RuntimePlatform;

	return {
		platform,
		open: (url) => rpc.request.open({ url }),
		pickFolder: (params) => rpc.request.pickFolder(params),
		getModelProviders: async () =>
			platform === "macos" && (await rpc.request.afmAvailability())
				? [AFMProvider]
				: [],
		shell: {
			os: platform === "windows" || platform === "linux" ? platform : "macos",
			cwd: () => rpc.request.cwd(),
			resolveDir: (params) => rpc.request.resolveDir(params),
			locate: (params) => rpc.request.locate(params),
			readFile: async (params) => {
				const file = await rpc.request.readFile(params);
				return { path: file.path, data: FileUtils.getBufferFromBytes(file) };
			},
			readFiles: async (params) =>
				(await rpc.request.readFiles(params)).map(
					(file) =>
						file && {
							data: FileUtils.getBufferFromBytes(file),
							size: file.size,
						},
				),
			readDir: (params) => rpc.request.readDir(params),
			walk: (params) => rpc.request.walk(params),
			writeFile: (params) => rpc.request.writeFile(params),
			// Output arrives while it runs; the resolved value still carries all of
			// it. It is stopped by the id it was started under.
			spawn: async ({ program, args, cwd, env, stream, abort }) => {
				abort?.throwIfAborted();
				const id = CommonUtils.getRandomId();
				const kill = () => void rpc.request.kill({ id });
				if (stream) spawnListeners.set(id, stream);
				abort?.addEventListener("abort", kill, { once: true });
				try {
					return await rpc.request.spawn({ id, program, args, cwd, env });
				} finally {
					spawnListeners.delete(id);
					abort?.removeEventListener("abort", kill);
				}
			},
		},
		transports: {
			createStdio: ({ name, command, env, onStderr }) =>
				new RpcTransport(rpc, { type: "stdio", name, command, env }, onStderr),
			createStreamableHttp: ({ name, url, headers }) =>
				new RpcTransport(rpc, {
					type: "http",
					name,
					url: String(url),
					headers,
				}),
		},
		update: {
			check: () => rpc.request.updateCheck(),
			install: async ({ onProgress }) => {
				updateListener = onProgress;
				try {
					await rpc.request.updateInstall();
				} finally {
					updateListener = undefined;
				}
			},
		},
	};
}

/**
 * The desktop app's runtime: the GUI in an Electrobun webview, or the web's
 * in a browser (Vite's dev server, opened outside the app).
 */
export const runtime: ClientRuntime = window.__electrobun
	? create(connect())
	: RuntimeUtils.web;
