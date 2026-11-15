// biome-ignore-all lint/suspicious/noConfusingVoidType: a method that answers nothing

import type { AfmAvailability, AfmEvent, AfmRequest } from "@afmize/node";
import type { PluginListenerHandle } from "@capacitor/core";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import type { ClaudeCodeChannelMessage } from "@ryangarber/ai-sdk-providers/claude";
import type { CodexChannelMessage } from "@ryangarber/ai-sdk-providers/codex";
import type { CursorChannelMessage } from "@ryangarber/ai-sdk-providers/cursor";
import type { InstallProgress } from "computah/schema";
import type { ComputahRequest } from "#client/features/agent/types/computah.ts";

/** The name the plugin is registered under, on both sides. */
export const DESKTOP_PLUGIN = "Desktop";

/** A file's bytes, base64 encoded. */
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
 * What the webview (`runtime.ts`) asks of the main process (`plugin.ts`)
 * through the `Desktop` plugin, each method taking one argument. The main
 * process does what a webview cannot: the device's shell and file system,
 * processes and network for MCP servers, Apple Foundation Models, the
 * browser, terminal and apps the agent drives, and updates to the app itself.
 * What `@capacitor/app` already does there (URLs the app is opened with,
 * quitting) it is left to.
 */
export type DesktopMethods = {
	open: { params: { url: string }; response: void };
	pickFolder: {
		params: { defaultPath?: string };
		response: string | null;
	};

	cwd: { params: undefined; response: string };
	tmpdir: { params: undefined; response: string };
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
	rename: {
		params: { path: string; to: string };
		response: { path: string; success: true };
	};
	remove: {
		params: { path: string };
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
	 * A message to the Claude Code host the main process serves; its own
	 * arrive as `claudeCode`.
	 */
	claudeCode: { params: ClaudeCodeChannelMessage; response: void };

	/**
	 * A message to the Codex host the main process serves; its own arrive as
	 * `codex`.
	 */
	codex: { params: CodexChannelMessage; response: void };
	cursor: { params: CursorChannelMessage; response: void };
	cursorSignIn: { params: undefined; response: void };

	/**
	 * One method of one of computah's surfaces, as
	 * `ComputahHostService.serve` answers it; install progress arrives as
	 * `computahProgress` under `id`.
	 */
	computah: { params: ComputahRequest; response: unknown };
	/** The call still answers, with however far it got. */
	computahAbort: { params: { id: string }; response: void };

	updateCheck: {
		params: undefined;
		response: { version: string; date?: string } | null;
	};
	/** Progress arrives as `updateProgress`; the app relaunches after. */
	updateInstall: { params: undefined; response: void };
};

/** What the main process tells the webview unasked, as plugin events. */
export type DesktopEvents = {
	spawnOutput: { id: string; type: "stdout" | "stderr"; value: string };
	mcpMessage: { id: string; message: JSONRPCMessage };
	mcpStderr: { id: string; text: string };
	mcpError: { id: string; message: string };
	mcpClose: { id: string };
	afmEvent: { key: number; event: AfmEvent };
	claudeCode: ClaudeCodeChannelMessage;
	codex: CodexChannelMessage;
	cursor: CursorChannelMessage;
	computahProgress: { id: string; progress: InstallProgress };
	updateProgress: { fraction: number };
	/** File → New Chat, from the app's menu. */
	newChat: undefined;
};

/** The main process's handlers for some of the webview's methods. */
export type DesktopHandlers<K extends keyof DesktopMethods> = {
	[M in K]: (
		params: DesktopMethods[M]["params"],
	) => Promise<DesktopMethods[M]["response"]>;
};

/** What the main process sends the webview unasked. */
export type DesktopSend = {
	[E in keyof DesktopEvents]: (payload: DesktopEvents[E]) => void;
};

/** The plugin as the webview's `registerPlugin` gives it. */
export type DesktopPlugin = {
	[M in keyof DesktopMethods]: undefined extends DesktopMethods[M]["params"]
		? () => Promise<DesktopMethods[M]["response"]>
		: (
				params: DesktopMethods[M]["params"],
			) => Promise<DesktopMethods[M]["response"]>;
} & {
	addListener<E extends keyof DesktopEvents>(
		event: E,
		listener: (payload: DesktopEvents[E]) => void,
	): Promise<PluginListenerHandle>;
};
