import type {
	ToolBlock,
	ToolCallContext,
	ToolDisplay,
	ToolStatusPiece,
} from "#core/features/tool/types/display.ts";
import type { ToolDefinition } from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

/** An agent's call's input, as loose as the agent sends it. */
export type AgentToolInput = Record<string, any>;

/** How one of an agent's own tools (Claude Code's, Codex's, Cursor's) is shown. */
export type AgentToolDisplay = ToolDisplay<ToolDefinition> & {
	/** Whether it can change files, which are then found and shown as diffs. */
	tracksChanges?: boolean;
};

type Context = ToolCallContext<ToolDefinition> & { input: AgentToolInput };

/** Helpers the agents' display tables are built from. */
export const AgentToolUtils = {
	/** A display read from the call's input, which is all most need. */
	make: ({
		status,
		input,
		output,
		text,
		tracksChanges,
	}: {
		status: (input: AgentToolInput) => ToolStatusPiece[];
		input?: (input: AgentToolInput) => ToolBlock[];
		output?: (call: Context) => ToolBlock[];
		text?: AgentToolDisplay["text"];
		tracksChanges?: boolean;
	}): AgentToolDisplay => ({
		status: (call) => status((call.input ?? {}) as AgentToolInput),
		input: input && ((call) => input((call.input ?? {}) as AgentToolInput)),
		output: output && ((call) => output(call as Context)),
		text,
		tracksChanges,
	}),

	str: (value: unknown): string => (typeof value === "string" ? value : ""),

	/** A shell command, shown as Tiny Chat's own `shell_exec` shows one. */
	command: (command: (input: AgentToolInput) => string): AgentToolDisplay =>
		AgentToolUtils.make({
			tracksChanges: true,
			status: (input) => ToolDisplayUtils.status.command(command(input)),
			input: (input) => [ToolDisplayUtils.command(command(input))],
			text: { title: "output", terminal: true },
		}),

	/**
	 * A subagent: what it was asked, then its conversation while it runs and
	 * its answer once done. Its calls are not watched one by one, so what it
	 * changed shows here.
	 */
	subagent: ({
		task,
		prompt,
	}: {
		task: (input: AgentToolInput) => string;
		prompt: (input: AgentToolInput) => string;
	}): AgentToolDisplay =>
		AgentToolUtils.make({
			tracksChanges: true,
			status: (input) => ToolDisplayUtils.status.subagent(task(input)),
			input: (input) => {
				const value = prompt(input);
				return value ? [ToolDisplayUtils.prompt(value)] : [];
			},
			output: ToolDisplayUtils.conversation,
			text: "prose",
		}),

	/** A to-do list the agent keeps. */
	todos: (todos: (input: AgentToolInput) => unknown): AgentToolDisplay =>
		AgentToolUtils.make({
			status: ToolDisplayUtils.status.todos,
			input: (input) => {
				const value = todos(input);
				return [ToolDisplayUtils.todos(Array.isArray(value) ? value : [])];
			},
		}),

	/** A plan the agent proposes. */
	plan: (plan: (input: AgentToolInput) => string): AgentToolDisplay =>
		AgentToolUtils.make({
			status: () => ToolDisplayUtils.status.plan(),
			input: (input) => [{ type: "markdown", value: plan(input) }],
		}),

	/** An image the agent generated, shown from the files in its result. */
	image: ({
		prompt,
		path,
	}: {
		prompt: (input: AgentToolInput) => string;
		path?: (input: AgentToolInput) => string;
	}): AgentToolDisplay =>
		AgentToolUtils.make({
			status: (input) => ToolDisplayUtils.status.image(prompt(input)),
			output: ({ input, files }) =>
				files.flatMap(
					(file) => ToolDisplayUtils.file({ path: path?.(input), file }) ?? [],
				),
		}),

	/** A file the agent read, its images and documents shown as files. */
	read: (path: (input: AgentToolInput) => string): AgentToolDisplay =>
		AgentToolUtils.make({
			status: (input) =>
				ToolDisplayUtils.status.paths({
					verb: ["Reading", "Read"],
					paths: [path(input)],
				}),
			output: ({ input, files }) =>
				files.flatMap(
					(file) => ToolDisplayUtils.file({ path: path(input), file }) ?? [],
				),
		}),
} as const;
