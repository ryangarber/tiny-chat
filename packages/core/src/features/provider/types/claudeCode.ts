import type { PromiseOrValue } from "#core/core/types/common.ts";

/** How Claude Code runs a chat: with its own tools, or with Tiny Chat's. */
export type ClaudeCodeMode = "claude-code" | "tiny-chat";

/** The server key Tiny Chat's tools are exposed under, in `tiny-chat` mode. */
export const CLAUDE_CODE_SERVER = "tinychat";
/** What Claude Code prefixes Tiny Chat's tool names with. */
export const CLAUDE_CODE_TOOL_PREFIX = `mcp__${CLAUDE_CODE_SERVER}__`;

/** A content block of a prompt, as the Messages API takes it. */
export type ClaudeCodeBlock =
	| { type: "text"; text: string }
	| {
			type: "image";
			source: { type: "base64"; media_type: string; data: string };
	  }
	| {
			type: "document";
			source: { type: "base64"; media_type: "application/pdf"; data: string };
			title?: string;
	  };

/** A block of an MCP tool result. */
export type ClaudeCodeToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

/** What a host takes to run one turn of Claude Code, as JSON. */
export interface ClaudeCodeRequest {
	/** A model alias (`haiku`, `sonnet`, `opus`) or full id. */
	model: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	mode: ClaudeCodeMode;
	/**
	 * Tiny Chat's instructions: appended to Claude Code's own in `claude-code`
	 * mode, and in place of them in `tiny-chat` mode.
	 */
	system?: string;
	/** The new user turn. */
	prompt: ClaudeCodeBlock[];
	/**
	 * The session the previous reply ran in. It is forked, so the turn never
	 * changes the session another message is resumed from.
	 */
	resume?: string;
	/**
	 * The chat so far, as a transcript, for a session that can't be resumed —
	 * the chat moved devices, or its earlier replies came from another model.
	 */
	history?: string;
	/** Where Claude Code runs; the host's home directory when unset. */
	cwd?: string;
	/** Tiny Chat's tools, in `tiny-chat` mode. */
	tools?: { name: string; description: string; inputSchema: unknown }[];
}

/**
 * The parts of Claude Code's SDK messages Tiny Chat reads. Anything else is
 * passed along untouched and ignored.
 */
export type ClaudeCodeMessage =
	| {
			type: "system";
			subtype: string;
			session_id?: string;
			model?: string;
	  }
	| {
			type: "stream_event";
			parent_tool_use_id: string | null;
			event: {
				type: string;
				index?: number;
				message?: { id: string };
				content_block?: { type: string; id?: string; name?: string };
				delta?: {
					type: string;
					text?: string;
					thinking?: string;
					partial_json?: string;
				};
			};
	  }
	| {
			type: "assistant";
			parent_tool_use_id: string | null;
			message: {
				id: string;
				content: {
					type: string;
					id?: string;
					name?: string;
					input?: unknown;
				}[];
			};
	  }
	| {
			type: "user";
			parent_tool_use_id: string | null;
			message: {
				content:
					| string
					| {
							type: string;
							tool_use_id?: string;
							is_error?: boolean;
							content?:
								| string
								| {
										type: string;
										text?: string;
										source?: {
											type: string;
											media_type?: string;
											data?: string;
										};
								  }[];
					  }[];
			};
	  }
	| {
			type: "result";
			subtype: string;
			is_error: boolean;
			session_id: string;
			result?: string;
			errors?: string[];
			total_cost_usd?: number;
			usage?: Record<string, unknown>;
	  }
	| { type: string; [key: string]: unknown };

/** One event of a run, as a host reports it. */
export type ClaudeCodeEvent =
	| { type: "message"; message: ClaudeCodeMessage }
	/** The run failed outside of Claude Code's own messages. */
	| { type: "error"; message: string }
	/** No more events follow, after a result, an error, or a cancel. */
	| { type: "end" };

export interface ClaudeCodeStatus {
	installed: boolean;
	loggedIn: boolean;
	version?: string;
	error?: string;
}

/** What a run asks of the generation while it goes. */
export interface ClaudeCodeHandlers {
	onEvent: (event: ClaudeCodeEvent) => void;
	/** Runs one of Tiny Chat's tools, in `tiny-chat` mode. */
	callTool: (call: {
		name: string;
		input: unknown;
		toolUseId?: string;
	}) => Promise<{ content: ClaudeCodeToolContent[]; isError?: boolean }>;
	/**
	 * Asks the user whether one of Claude Code's own tools may run, or, for one
	 * that asks them something, for their answer, in `updatedInput`.
	 */
	canUseTool: (call: {
		name: string;
		input: unknown;
		toolUseId: string;
	}) => Promise<{ allow: boolean; message?: string; updatedInput?: unknown }>;
}

/**
 * How a host runs Claude Code: the CLI in its own process, the desktop app in
 * its main process. The host runs the user's installed `claude`, signed in
 * through Claude Code's own login — Tiny Chat never handles credentials.
 */
export interface ClaudeCodeBridge {
	status: () => PromiseOrValue<ClaudeCodeStatus>;
	/** Starts a run, returning its id. Its input stays open until `close`. */
	run: (
		request: ClaudeCodeRequest,
		handlers: ClaudeCodeHandlers,
	) => PromiseOrValue<string>;
	cancel: (id: string) => PromiseOrValue<void>;
	/** Sends a message the user queued into a running session. */
	send: (id: string, prompt: ClaudeCodeBlock[]) => PromiseOrValue<void>;
	/**
	 * Ends a run's input: once Claude Code has answered everything sent, the
	 * run ends. Until then, a run stays open for `send`.
	 */
	close: (id: string) => PromiseOrValue<void>;
}
