import type { Transport } from "@modelcontextprotocol/client";
import { NodeTransportService } from "#client/features/agent/services/NodeTransportService.ts";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

export const McpHostService = {
	/**
	 * MCP transports run here rather than in the webview: a stdio server is a
	 * process the webview cannot start, and an HTTP one would need CORS
	 * headers few servers send. The webview's client speaks to each through
	 * `RpcTransport` by the id it chose.
	 */
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<
		"mcpStart" | "mcpSend" | "mcpSetProtocolVersion" | "mcpClose"
	> => {
		const node = NodeTransportService.create();
		const transports = new Map<string, Transport>();

		const get = (id: string) => {
			const transport = transports.get(id);
			if (!transport) throw new Error(`MCP transport ${id} is not running`);
			return transport;
		};

		return {
			mcpStart: async (params) => {
				const { id } = params;
				const transport =
					params.type === "stdio"
						? node.createStdio({
								name: params.name,
								command: params.command,
								// The user's own `PATH`, for `npx` and the like.
								env: await NodeShellService.env({
									env: params.env,
									login: true,
								}),
								onStderr: (text) => send.mcpStderr({ id, text }),
							})
						: node.createStreamableHttp({
								name: params.name,
								url: new URL(params.url),
								headers: params.headers,
							});

				transport.onmessage = (message) => send.mcpMessage({ id, message });
				transport.onerror = (error) =>
					send.mcpError({ id, message: error.message });
				transport.onclose = () => {
					transports.delete(id);
					send.mcpClose({ id });
				};

				transports.set(id, transport);
				try {
					await transport.start();
				} catch (error) {
					transports.delete(id);
					throw error;
				}
			},
			mcpSend: async ({ id, message, relatedRequestId }) => {
				await get(id).send(message, { relatedRequestId });
			},
			mcpSetProtocolVersion: async ({ id, version }) => {
				get(id).setProtocolVersion?.(version);
			},
			mcpClose: async ({ id }) => {
				await transports.get(id)?.close();
				transports.delete(id);
			},
		};
	},
} as const;
