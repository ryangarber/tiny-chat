import type { Readable } from "node:stream";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ClientTransports } from "#client/features/agent/types/transport.ts";

export const NodeTransportService = {
	/**
	 * MCP transports over Node's processes and network, for runtimes with
	 * Node's APIs (the CLI under Bun, the desktop app's main process). A stdio
	 * server gets `env` over a few safe variables of this process's own, so a
	 * host that needs more (a `PATH`) passes them.
	 */
	create: (): Required<ClientTransports> => ({
		createStdio: ({ name, command, env, onStderr }) => {
			const transport = new StdioClientTransport({
				command: command[0],
				args: command.slice(1),
				env,
				// Inherited, a server's stderr would write over the terminal UI.
				stderr: "pipe",
			});
			// A `PassThrough`, there from the start when piped.
			const stderr = transport.stderr as Readable | null;
			stderr?.setEncoding("utf8");
			stderr?.on("data", (chunk: string) => {
				if (onStderr) onStderr(chunk);
				else console.warn(`[mcp] ${name}:`, chunk);
			});
			return transport;
		},
		createStreamableHttp: ({ url, headers }) => {
			return new StreamableHTTPClientTransport(new URL(url), {
				requestInit: { headers },
			});
		},
	}),
} as const;
