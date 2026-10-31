import type { z } from "zod";
import type { DeepPartial } from "#core/core/types/common.ts";
import type { zData, zFilePart } from "#core/features/data/types/part.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import type { ToolDefinition } from "#core/features/tool/types/tool.ts";

/**
 * One piece of a tool call's status line.
 *
 * - `string` is shown as is.
 * - `[pending, done]` follows the call's tense.
 * - `{ subject }` is what the call acts on, and is emphasized.
 * - `{ count: [one, many] }` is the noun the call is counted by when it is
 *   combined with calls like it: `Read 2 files`. On its own it reads as the
 *   bare singular noun (`Read file a.txt`), or as its `subject` when it has one
 *   (`Searched web for cats`, combined as `Searched web for 2 queries`).
 *
 * Only the pieces up to and including `count` make it into a combined line, so
 * everything specific to one call belongs after it.
 */
export type ToolStatusPiece =
	| string
	| [pending: string, done: string]
	| { subject: string }
	| { count: [one: string, many: string]; subject?: string };

/** A status piece resolved to the text a renderer shows. */
export interface ToolStatusPart {
	text: string;
	subject?: boolean;
}

/**
 * Where a tool call is in its life.
 *
 * - `input`: the model is still writing the call's input.
 * - `feedback`: waiting on the user to approve it or answer it.
 * - `running`: executing; any output it reports is streamed.
 */
export type ToolCallState =
	| "input"
	| "feedback"
	| "running"
	| "success"
	| "error"
	| "rejected";

/**
 * A renderer-agnostic piece of tool content. Runtimes (app, CLI) know how to
 * draw each of these, so a tool describes what it shows in these terms and
 * never needs UI code of its own.
 */
export type ToolBlock =
	| { type: "text"; value: string; tone?: "dimmed" | "error" }
	| { type: "markdown"; value: string; quote?: boolean }
	/** Source or terminal text. `terminal` output follows its tail as it grows. */
	| {
			type: "code";
			value: string;
			language?: string;
			title?: string;
			terminal?: boolean;
	  }
	/** A file's contents: text, or an image as a data URL. */
	| {
			type: "file";
			path: string;
			content?: string;
			image?: string;
			language?: string;
	  }
	| {
			type: "diff";
			path?: string;
			before: string;
			after: string;
			language?: string;
	  }
	| {
			type: "directory";
			path: string;
			entries: { path: string; directory?: boolean }[];
	  }
	| { type: "web"; source: zWebContext }
	/** Something the user owns — an action, a memory, a chat. */
	| {
			type: "record";
			title: string;
			description?: string;
			details?: string[];
			/** Chat the record links to. */
			chat?: string;
	  }
	| { type: "json"; value: unknown; title?: string }
	/** A nested conversation, such as a subagent's. */
	| { type: "messages"; data: zData };

/** An input the user fills in before a tool that asks for feedback runs. */
export type ToolField = {
	type: "choice";
	/** Key the value is sent under in the tool's feedback. */
	name: string;
	/** What the field asks, where a call has more than one. */
	label?: string;
	/** A short tag for the field, shown beside its label. */
	header?: string;
	options: ToolFieldOption[];
	/**
	 * Whether several options can be picked. They are sent together, with
	 * anything written in, joined by commas.
	 */
	multiple?: boolean;
	/** Whether something other than the options can be written in. */
	custom?: boolean;
	placeholder?: string;
};

export interface ToolFieldOption {
	label: string;
	description?: string;
}

export interface ToolControls {
	/** Approve / deny, rather than just continue. */
	approval: boolean;
	fields: ToolField[];
}

/** What a tool's display functions are given about one of its calls. */
export interface ToolCallContext<T extends ToolDefinition> {
	state: ToolCallState;
	/** Partial while `state` is `input`. */
	input: DeepPartial<z.infer<T["input"]>>;
	/** Every JSON value in the result, flattened. */
	output: z.infer<T["output"]>[];
	files: zFilePart[];
	/** Output reported while running, cleared once the result lands. */
	stream: T["stream"] extends z.ZodType ? z.infer<T["stream"]>[] : never[];
}

/**
 * How a tool presents its calls. Lives beside the tool's definition, so a new
 * tool brings its own presentation and runtimes stay generic.
 */
export interface ToolDisplay<T extends ToolDefinition> {
	status: (call: ToolCallContext<T>) => ToolStatusPiece[];
	/** What the call was asked to do. Shown as it streams in. */
	input?: (call: ToolCallContext<T>) => ToolBlock[];
	/**
	 * What it produced — from the stream while running and from the result
	 * once done, drawn by the same blocks so nothing jumps when it settles.
	 */
	output?: (call: ToolCallContext<T>) => ToolBlock[];
	/** What the user fills in, for a tool with `feedback`. */
	fields?: (call: ToolCallContext<T>) => ToolField[];
}

/** A tool call resolved for rendering. */
export interface ToolCallDisplay {
	id: string;
	/** The tool's own name, without any toolset prefix. */
	name: string;
	state: ToolCallState;
	/** Still moving: streaming, running or waiting on the user. */
	active: boolean;
	status: ToolStatusPart[];
	input: ToolBlock[];
	output: ToolBlock[];
	/** Present only while waiting on the user. */
	controls?: ToolControls;
}
