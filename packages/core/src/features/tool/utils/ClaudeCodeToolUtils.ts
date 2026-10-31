import { askQuestionDisplay } from "#core/features/tool/tools/questions/ask_question.ts";
import type {
	ToolBlock,
	ToolDisplay,
	ToolStatusPiece,
} from "#core/features/tool/types/display.ts";
import type { ToolDefinition } from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

type Input = Record<string, any>;
type Display = ToolDisplay<ToolDefinition>;

/** A display read from the call's input alone, which is all these need. */
const make = ({
	status,
	input,
}: {
	status: (input: Input) => ToolStatusPiece[];
	input?: (input: Input) => ToolBlock[];
}): Display => ({
	status: (call) => status((call.input ?? {}) as Input),
	input: input && ((call) => input((call.input ?? {}) as Input)),
});

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** The command's first word, enough to tell commands apart in a status line. */
const program = (command: string) => command.trim().split(/\s+/)[0] ?? "";

const diff = (input: Input, before: string, after: string) => ({
	type: "diff" as const,
	path: str(input.file_path),
	before,
	after,
	language: ToolDisplayUtils.language(str(input.file_path)),
});

/**
 * How Claude Code's own tools are shown, in the look of their Tiny Chat
 * counterparts. Their results are text, which every call shows as is.
 */
const displays: Record<string, Display> = {
	Bash: make({
		status: (input: Input) => [
			["Running", "Ran"],
			{ count: ["command", "commands"], subject: program(str(input.command)) },
		],
		input: (input: Input) => [
			{ type: "code", value: str(input.command), language: "bash" },
		],
	}),
	Read: make({
		status: (input: Input) => [
			["Reading", "Read"],
			{ count: ["file", "files"] },
			{ subject: ToolDisplayUtils.name(str(input.file_path)) },
		],
	}),
	Write: make({
		status: (input: Input) => [
			["Writing", "Wrote"],
			{ count: ["file", "files"] },
			{ subject: ToolDisplayUtils.name(str(input.file_path)) },
		],
		input: (input: Input) => [
			{
				type: "file",
				path: str(input.file_path),
				content: str(input.content),
				language: ToolDisplayUtils.language(str(input.file_path)),
			},
		],
	}),
	Edit: make({
		status: (input: Input) => [
			["Editing", "Edited"],
			{ count: ["file", "files"] },
			{ subject: ToolDisplayUtils.name(str(input.file_path)) },
		],
		input: (input: Input) => [
			diff(input, str(input.old_string), str(input.new_string)),
		],
	}),
	MultiEdit: make({
		status: (input: Input) => [
			["Editing", "Edited"],
			{ count: ["file", "files"] },
			{ subject: ToolDisplayUtils.name(str(input.file_path)) },
		],
		input: (input: Input) =>
			(Array.isArray(input.edits) ? input.edits : []).map((edit: Input) =>
				diff(input, str(edit?.old_string), str(edit?.new_string)),
			),
	}),
	Glob: make({
		status: (input: Input) => [
			["Finding", "Found"],
			{ count: ["files", "files"], subject: str(input.pattern) },
		],
	}),
	Grep: make({
		status: (input: Input) => [
			["Grepping", "Grepped"],
			{ count: ["pattern", "patterns"], subject: str(input.pattern) },
		],
	}),
	WebSearch: make({
		status: (input: Input) => [
			["Searching", "Searched"],
			"web for",
			{ count: ["query", "queries"], subject: str(input.query) },
		],
	}),
	WebFetch: make({
		status: (input: Input) => [
			["Viewing", "Viewed"],
			{ count: ["page", "pages"], subject: str(input.url) },
		],
	}),
	TodoWrite: make({
		status: () => [
			["Updating", "Updated"],
			{ count: ["todo list", "todo lists"] },
		],
		input: (input: Input) => [
			{
				type: "markdown",
				value: (Array.isArray(input.todos) ? input.todos : [])
					.map(
						(todo: Input) =>
							`- [${todo?.status === "completed" ? "x" : " "}] ${str(todo?.content)}`,
					)
					.join("\n"),
			},
		],
	}),
	Task: make({
		status: (input: Input) => [
			["Running", "Ran"],
			{ count: ["subagent", "subagents"], subject: str(input.description) },
		],
		input: (input: Input) => [
			{ type: "markdown", value: str(input.prompt), quote: true },
		],
	}),
};
displays.Agent = displays.Task;
// Answered through the user's feedback, as Tiny Chat's own questions are.
displays.AskUserQuestion = askQuestionDisplay;

export const ClaudeCodeToolUtils = {
	/** How one of Claude Code's own tools is shown, if it is one. */
	getDisplay: (name: string): Display | undefined =>
		Object.hasOwn(displays, name) ? displays[name] : undefined,
} as const;
