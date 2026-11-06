// biome-ignore-all lint/suspicious/noConfusingVoidType: a request that answers nothing

import type { AfmAvailability, AfmEvent, AfmRequest } from "@afmize/node";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import type { ClaudeCodeChannelMessage } from "@ryangarber/ai-sdk-providers/claude";
import type { CodexChannelMessage } from "@ryangarber/ai-sdk-providers/codex";
import type { RPCSchema } from "electrobun/view";

/** A file's bytes, base64 encoded, since RPC carries JSON. */
type Bytes = string;

/** An MCP server for the main process to connect to. */
export type McpServer =
	| {
			type: "stdio";
			name: string;
			command: string[];
			env?: Record<string, string>;
	  }
	| {
			type: "http";
			name: string;
			url: string;
			headers?: Record<string, string>;
	  };

/**
 * What the webview (`client-runtime.ts`) asks of the main process (`index.ts`),
 * and what the main process tells it in return. The main process does what a
 * webview cannot: the device's shell and file system, processes and network
 * for MCP servers, Apple Foundation Models, the apps on the computer, URLs the
 * app is opened with, and updates to the app itself.
 */
export type DesktopRPC = {
	bun: RPCSchema<{
		requests: {
			open: { params: { url: string }; response: void };
			pickFolder: {
				params: { defaultPath?: string };
				response: string | null;
			};

			cwd: { params: undefined; response: string };
			resolveDir: { params: { path: string }; response: string };
			locate: { params: { paths: readonly string[] }; response: string | null };
			readFile: {
				params: { path: string };
				response: { path: string; data: Bytes };
			};
			readFiles: {
				params: { paths: string[]; maxBytes: number };
				response: ({ data: Bytes; size: number } | null)[];
			};
			readDir: {
				params: { path: string };
				response: { path: string; is_dir: boolean }[];
			};
			walk: {
				params: {
					path: string;
					maxDepth: number;
					maxEntries: number;
					prune: string[];
				};
				response: {
					root: string;
					entries: { path: string; is_dir: boolean; size?: number }[];
					truncated: boolean;
				};
			};
			writeFile: {
				params: { path: string; content: string };
				response: { path: string; success: true };
			};
			/** Output arrives as `spawnOutput` under `id` while it runs. */
			spawn: {
				params: {
					id: string;
					program: string;
					args: string[];
					cwd?: string;
					env?: Record<string, string>;
				};
				response: { code?: number; stdout: string; stderr: string };
			};
			kill: { params: { id: string }; response: void };

			/** Messages, errors and the end arrive as `mcp*` under `id`. */
			mcpStart: {
				params: McpServer & { id: string };
				response: void;
			};
			mcpSend: {
				params: {
					id: string;
					message: JSONRPCMessage;
					relatedRequestId?: string | number;
				};
				response: void;
			};
			mcpSetProtocolVersion: {
				params: { id: string; version: string };
				response: void;
			};
			mcpClose: { params: { id: string }; response: void };

			/** afmize's availability report, or null where it cannot run. */
			afmAvailability: { params: undefined; response: AfmAvailability | null };
			/** Events arrive as `afmEvent` under `key`, `finish` last. */
			afmStream: {
				params: { key: number; request: AfmRequest };
				response: void;
			};
			/** The stream's `finish` still arrives. */
			afmCancel: { params: { key: number }; response: void };

			/**
			 * A message to the Claude Code host the main process serves; its
			 * own arrive as `claudeCode`.
			 */
			claudeCode: { params: ClaudeCodeChannelMessage; response: void };

			/**
			 * A message to the Codex host the main process serves; its own
			 * arrive as `codex`.
			 */
			codex: { params: CodexChannelMessage; response: void };

			/** `ComputerHostService`'s raw `{ ok, result }` or `{ ok, error }`. */
			computerCall: {
				params: { method: string; params: unknown };
				response: unknown;
			};

			quit: { params: undefined; response: void };

			/**
			 * The URL the app was last opened with (`tinychat://`), once; later
			 * ones arrive as `openUrl`.
			 */
			takeOpenUrl: { params: undefined; response: string | null };

			updateCheck: {
				params: undefined;
				response: { version: string } | null;
			};
			/** Progress arrives as `updateProgress`; the app relaunches after. */
			updateInstall: { params: undefined; response: void };
		};
		messages: Record<never, never>;
	}>;
	webview: RPCSchema<{
		requests: Record<never, never>;
		messages: {
			spawnOutput: { id: string; type: "stdout" | "stderr"; value: string };
			mcpMessage: { id: string; message: JSONRPCMessage };
			mcpStderr: { id: string; text: string };
			mcpError: { id: string; message: string };
			mcpClose: { id: string };
			afmEvent: { key: number; event: AfmEvent };
			claudeCode: ClaudeCodeChannelMessage;
			codex: CodexChannelMessage;
			updateProgress: { fraction: number };
			openUrl: { url: string };
		};
	}>;
};

type Requests = DesktopRPC["bun"]["requests"];
type Messages = DesktopRPC["webview"]["messages"];

/** The main process's handlers for some of the webview's requests. */
export type DesktopHandlers<K extends keyof Requests> = {
	[M in K]: (params: Requests[M]["params"]) => Promise<Requests[M]["response"]>;
};

/** What the main process sends the webview unasked. */
export type DesktopSend = {
	[M in keyof Messages]: (payload: Messages[M]) => void;
};
