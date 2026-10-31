import type { PromiseOrValue } from "#core/core/types/common.ts";
import type { zFileChanges } from "#core/features/data/types/part.ts";

/** The server key Tiny Chat's tools are exposed under. */
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

export const CLAUDE_CODE_EFFORTS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
/** @lintignore */
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORTS)[number];

/** Claude Code's own permission modes. */
export const CLAUDE_CODE_PERMISSION_MODES = [
	"default",
	"acceptEdits",
	"plan",
	"auto",
	"dontAsk",
	"bypassPermissions",
] as const;
/** @lintignore */
export type ClaudeCodePermissionMode =
	(typeof CLAUDE_CODE_PERMISSION_MODES)[number];

/** How Claude thinks: shown summarized, hidden, or not at all. */
export type ClaudeCodeThinking = "summarized" | "omitted" | "disabled";

/**
 * Thinking as Claude Code takes it: adaptive on the models that decide how
 * much to think themselves, and on a fixed budget on others.
 */
export type ClaudeCodeThinkingConfig =
	| { type: "adaptive" | "enabled"; display: "summarized" | "omitted" }
	| { type: "disabled" };

/**
 * How the user set Claude Code up, from the provider's settings. Strings, as
 * every provider setting is, read by the host.
 */
export interface ClaudeCodeSettings {
	/** The `claude` to run, in place of the one found on the login shell's path. */
	executable?: string;
	/**
	 * Settings above all of those files, as Claude Code's `settings.json` takes
	 * them: a JSON object, or the path of a file holding one.
	 */
	settings?: string;
}

/** What a host takes to run one turn of Claude Code, as JSON. */
export interface ClaudeCodeRequest {
	/** A model alias (`haiku`, `sonnet`, `opus`) or full id. */
	model: string;
	effort?: ClaudeCodeEffort;
	thinking?: ClaudeCodeThinkingConfig;
	/**
	 * Claude Code's own tools and prompt, with the setup they come with: its
	 * settings files, MCP servers and connectors. Off, it runs bare, with only
	 * what `system` and `tools` give it.
	 */
	claudeCode: boolean;
	/** How Claude Code's own permission flow decides on its own tools. */
	permissions: ClaudeCodePermissionMode;
	/** One of Claude Code's agents, to run the main thread as. */
	agent?: string;
	/** One of Claude Code's output styles. */
	outputStyle?: string;
	/** Claude Code's fast mode, where the model supports it. */
	fastMode?: boolean;
	/** A JSON schema the reply's structured output must match. */
	schema?: Record<string, unknown>;
	settings?: ClaudeCodeSettings;
	/**
	 * Tiny Chat's instructions, if it brings them: after Claude Code's own
	 * prompt, or as the whole of it without one.
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
	/**
	 * The chat's folders: Claude Code runs in the first, the primary one, and
	 * may also work in the rest. The host's home directory when there are none.
	 */
	folders?: string[];
	/**
	 * Tiny Chat's tools, if it brings them. They run through `callTool`, and
	 * ask the user as Tiny Chat's own tools do.
	 */
	tools?: { name: string; description: string; inputSchema: unknown }[];
}

/** One of the models Claude Code offers the signed-in account. */
export interface ClaudeCodeModel {
	/** What to pass as the model: an alias such as `sonnet`, or a full id. */
	value: string;
	displayName?: string;
	efforts?: ClaudeCodeEffort[];
	adaptiveThinking?: boolean;
	fastMode?: boolean;
	autoMode?: boolean;
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
			/** A task's: a subagent's, for one the Agent tool started. */
			task_id?: string;
			tool_use_id?: string;
			/** A task that runs on while the call that started it returns. */
			is_backgrounded?: boolean;
			/** How a task ended. */
			status?: "completed" | "failed" | "stopped";
			summary?: string;
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
			/** The reply as the request's schema has it. */
			structured_output?: unknown;
			total_cost_usd?: number;
			usage?: Record<string, unknown>;
	  }
	| { type: string; [key: string]: unknown };

/** One event of a run, as a host reports it. */
export type ClaudeCodeEvent =
	| { type: "message"; message: ClaudeCodeMessage }
	/** What one of Claude Code's own calls changed, found beside it. */
	| { type: "changes"; toolUseId: string; changes: zFileChanges }
	/** The run failed outside of Claude Code's own messages. */
	| { type: "error"; message: string }
	/** No more events follow, after a result, an error, or a cancel. */
	| { type: "end" };

export interface ClaudeCodeStatus {
	installed: boolean;
	loggedIn: boolean;
	version?: string;
	error?: string;
	/** What the signed-in `claude` offers, once it has been asked. */
	models?: ClaudeCodeModel[];
	/** Its agents, from the user's settings and Claude Code's own. */
	agents?: string[];
	outputStyles?: string[];
	/** The output style its settings pick. */
	outputStyle?: string;
}

/** What a run asks of the generation while it goes. */
export interface ClaudeCodeHandlers {
	onEvent: (event: ClaudeCodeEvent) => void;
	/** Runs one of Tiny Chat's tools. */
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
	status: (
		settings?: Pick<ClaudeCodeSettings, "executable">,
	) => PromiseOrValue<ClaudeCodeStatus>;
	/** Starts a run, returning its id. Its input stays open until `close`. */
	run: (
		request: ClaudeCodeRequest,
		handlers: ClaudeCodeHandlers,
	) => PromiseOrValue<string>;
	cancel: (id: string) => PromiseOrValue<void>;
	/** Stops one subagent of a run, by the call that started it. */
	stopTask: (id: string, toolUseId: string) => PromiseOrValue<void>;
	/** Sends a message the user queued into a running session. */
	send: (id: string, prompt: ClaudeCodeBlock[]) => PromiseOrValue<void>;
	/**
	 * Ends a run's input: once Claude Code has answered everything sent, the
	 * run ends. Until then, a run stays open for `send`.
	 */
	close: (id: string) => PromiseOrValue<void>;
}
