/** biome-ignore-all lint/suspicious/noConfusingVoidType: no input expected */

import type { z } from "zod";
import type { Capabilities } from "#core/core/types/capability.ts";
import type { DistributiveOmit } from "#core/core/types/common.ts";
import type { StreamMutation } from "#core/core/types/stream.ts";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import type {
	zDataSimplePart,
	zJsonPart,
} from "#core/features/data/types/part.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";

export interface ToolDefinition {
	name: string;
	description: string;
	input: z.ZodType;
	feedback?: z.ZodType | void;
	output: z.ZodType;
	stream?: z.ZodType | void;
}

interface ToolValidation {
	approval?: boolean;
}

/** The user's answer to a call that waits on one. */
export interface ToolFeedback {
	/** For a call that needs approval: false rejects it. */
	approved?: boolean;
	/** Passed to `execute` as its `feedback`. */
	feedback?: unknown;
}

export type OutputPart<TDefinition extends ToolDefinition> =
	| Exclude<zDataSimplePart, { type: "json" }>
	| (Omit<zJsonPart, "value"> & {
			value: z.infer<TDefinition["output"]>;
	  });

export interface Tool<
	TDefinition extends ToolDefinition,
	TCapabilities extends Record<string, Capabilities[keyof Capabilities]> | void,
> extends ToolDefinition {
	prefix?: string;
	capabilities: TCapabilities;

	input: TDefinition["input"];
	feedback?: TDefinition["feedback"];
	output: TDefinition["output"];
	stream?: TDefinition["stream"];

	/** How calls are shown. Without it, input and output are shown raw. */
	display?: ToolDisplay<TDefinition>;

	/**
	 * Calls the model makes together run at the same time. A `sequential` tool
	 * runs alone instead: after every call before it has settled, and before any
	 * after it starts. For tools whose calls would race, like edits to a file.
	 */
	sequential?: boolean;

	/**
	 * Whether a call can run in the background, when its input sets
	 * `background: true`. The call settles at once with a placeholder and the
	 * model carries on; its result reaches the model once it finishes, and the
	 * generation does not end before it has.
	 */
	background?: boolean;

	/**
	 * Whether files a call changes are found and shown as diffs, for tools that
	 * can change files without saying which: a shell, an MCP server's tool.
	 * Tools that write files themselves show their own edits instead. An
	 * agent's own tools say so in their display; any other tool without a
	 * display of its own is assumed to change files.
	 */
	tracksChanges?: boolean;

	/**
	 * Runs before `execute`, and before the loop stops for approval or feedback.
	 * Throw to fail the call outright: the error becomes the tool result and the
	 * model gets to correct itself, rather than the user being asked to approve
	 * a call that was never going to work.
	 */
	validate?: (_: {
		input: z.infer<TDefinition["input"]>;
		context: zAgentContext;
	}) => Promise<ToolValidation | undefined>;

	/**
	 * `stream` lets a long-running tool report output before it finishes, so
	 * the UI can show it live. Whatever is reported this way still has to appear
	 * in the resolved result: nothing streamed is persisted.
	 */
	execute: (_: {
		/** The id of the call's part, when it runs for one. */
		id?: string;
		input: z.infer<TDefinition["input"]>;
		feedback: z.infer<TDefinition["feedback"]>;
		context: zAgentContext;
		stream?: (_: StreamMutation<z.infer<TDefinition["stream"]>>) => void;
		abort?: AbortSignal;
	}) => Promise<DistributiveOmit<OutputPart<TDefinition>, "id">[]>;
}

export type ToolFactory<T extends Tool<any, any>> = (options: {
	prefix?: string;
	capabilities: T["capabilities"];
}) => T | Promise<T>;

interface ToolsetStatus {
	valid: boolean;
	error?: unknown;
}

export interface Toolset<
	TCapabilities extends Record<string, Capabilities[keyof Capabilities]> | void,
> {
	name: string;
	instructions?: string;
	prefix?: string;
	tools: Tool<any, TCapabilities>[];
	capabilities: TCapabilities;
	status: ToolsetStatus;
	/**
	 * Turns the toolset on by what the chat holds rather than by the message's
	 * `config.toolsets`, as the plan's is by `/plan`. Such a toolset is never
	 * offered among those the user picks.
	 */
	when?: (context: zAgentContext) => boolean;
}

export type ToolsetFactory<T extends Toolset<any>> = (options: {
	prefix?: string;
	instructions?: string;
	capabilities: T["capabilities"];
	status: ToolsetStatus;
}) => T | Promise<T>;
