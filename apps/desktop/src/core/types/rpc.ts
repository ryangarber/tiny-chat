// biome-ignore-all lint/suspicious/noConfusingVoidType: a request that answers nothing

import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import type { RPCSchema } from "electrobun/view";
import type {
	AFMEvent,
	AFMRequest,
} from "#core/features/provider/types/afm.ts";
import type {
	ClaudeCodeBlock,
	ClaudeCodeEvent,
	ClaudeCodeHandlers,
	ClaudeCodeRequest,
	ClaudeCodeStatus,
} from "#core/features/provider/types/claudeCode.ts";

/** A file's bytes, base64 encoded, since RPC carries JSON. */
type Bytes = string;

/** What a Claude Code run asks of the webview while it goes. */
export type ClaudeCodeQuestion =
	| ({ type: "tool" } & Parameters<ClaudeCodeHandlers["callTool"]>[0])
	| ({ type: "permission" } & Parameters<ClaudeCodeHandlers["canUseTool"]>[0]);

/** The webview's answer to a {@link ClaudeCodeQuestion}; `none` once it can't give one. */
export type ClaudeCodeAnswer =
	| {
			type: "tool";
			result: Awaited<ReturnType<ClaudeCodeHandlers["callTool"]>>;
	  }
	| {
			type: "permission";
			result: Awaited<ReturnType<ClaudeCodeHandlers["canUseTool"]>>;
	  }
	| { type: "none" };

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

			/** afmize's availability report, or null where it is not built in. */
			afmAvailability: { params: undefined; response: string | null };
			/** Events arrive as `afmEvent` under `key`; returns the stream's id. */
			afmStream: {
				params: { key: number; request: AFMRequest };
				response: number;
			};
			afmCancel: { params: { id: number }; response: void };

			claudeCodeStatus: { params: undefined; response: ClaudeCodeStatus };
			/**
			 * Events arrive as `claudeCodeEvent` and questions as
			 * `claudeCodeQuestion`, under `key`; returns the run's id.
			 */
			claudeCodeRun: {
				params: { key: number; request: ClaudeCodeRequest };
				response: string;
			};
			claudeCodeCancel: { params: { id: string }; response: void };
			claudeCodeSend: {
				params: { id: string; prompt: ClaudeCodeBlock[] };
				response: void;
			};
			claudeCodeClose: { params: { id: string }; response: void };
			claudeCodeAnswer: {
				params: { id: string; answer: ClaudeCodeAnswer };
				response: void;
			};

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
			afmEvent: { key: number; event: AFMEvent };
			claudeCodeEvent: { key: number; event: ClaudeCodeEvent };
			claudeCodeQuestion: { key: number; id: string } & ClaudeCodeQuestion;
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
