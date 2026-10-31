import type { zData } from "#core/features/data/types/part.ts";
import { askQuestionDisplay } from "#core/features/tool/tools/questions/ask_question.ts";
import type {
	ToolBlock,
	ToolDisplay,
	ToolStatusPiece,
} from "#core/features/tool/types/display.ts";
import type { ToolDefinition } from "#core/features/tool/types/tool.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

type Input = Record<string, any>;
type Display = ToolDisplay<ToolDefinition> & {
	/**
	 * How the text of its result is shown: as `prose` (a subagent's answer) or
	 * as code, under `title` when given. Beside files, it is a notice.
	 */
	text?: { prose?: boolean; title?: string };
};

/** A display read from the call's input alone, which is all these need. */
const make = ({
	status,
	input,
	text,
}: {
	status: (input: Input) => ToolStatusPiece[];
	input?: (input: Input) => ToolBlock[];
	text?: Display["text"];
}): Display => ({
	status: (call) => status((call.input ?? {}) as Input),
	input: input && ((call) => input((call.input ?? {}) as Input)),
	text,
});

const str = (value: unknown) => (typeof value === "string" ? value : "");

const diff = (input: Input, before: string, after: string) => ({
	type: "diff" as const,
	path: str(input.file_path),
	before,
	after,
	language: ToolDisplayUtils.language(str(input.file_path)),
});

/**
 * How Claude Code's own tools are shown, in the look of their Tiny Chat
 * counterparts. Their results are mostly text, which every call shows as is;
 * the images and documents `Read` takes in are shown as files.
 */
const displays: Record<string, Display> = {
	Bash: make({
		status: (input: Input) => [
			["Running", "Ran"],
			{
				count: ["command", "commands"],
				subject: ShellUtils.programs(str(input.command)),
			},
		],
		input: (input: Input) => [
			{
				type: "code",
				value: str(input.command),
				language: "bash",
				title: "input",
			},
		],
		text: { title: "output" },
	}),
	Read: {
		...make({
			status: (input: Input) => [
				["Reading", "Read"],
				{ count: ["file", "files"] },
				{ subject: ToolDisplayUtils.name(str(input.file_path)) },
			],
		}),
		// Images, PDFs and notebooks' figures; text comes back as text.
		output: ({ input, files }) =>
			files.flatMap(
				(file) =>
					ToolDisplayUtils.file({
						path: str((input as Input).file_path),
						file,
					}) ?? [],
			),
	},
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
	Task: {
		...make({
			status: (input: Input) => [
				["Using", "Used"],
				{ count: ["subagent", "subagents"], subject: str(input.description) },
			],
			input: (input: Input) => [
				{ type: "markdown", value: str(input.prompt), quote: true },
			],
		}),
		// Its conversation while it runs, as Tiny Chat's own subagents show
		// theirs; the answer it gave once it is done.
		output: ({ state, stream }) => {
			const data = state === "running" ? stream.at(-1) : undefined;
			return data ? [{ type: "messages", data: data as zData }] : [];
		},
		text: { prose: true },
	},
	NotebookEdit: make({
		status: (input: Input) => [
			["Editing", "Edited"],
			{ count: ["notebook", "notebooks"] },
			{ subject: ToolDisplayUtils.name(str(input.notebook_path)) },
		],
		input: (input: Input) => [
			{
				type: "code",
				value: str(input.new_source),
				language: input.cell_type === "markdown" ? "markdown" : "python",
			},
		],
	}),
	ExitPlanMode: make({
		status: () => [["Proposing", "Proposed"], { count: ["plan", "plans"] }],
		input: (input: Input) => [{ type: "markdown", value: str(input.plan) }],
	}),
	EnterPlanMode: make({
		status: () => [["Planning", "Planned"]],
	}),
	Skill: make({
		status: (input: Input) => [
			["Using", "Used"],
			{ count: ["skill", "skills"], subject: str(input.skill) },
		],
	}),
	BashOutput: make({
		status: () => [
			["Reading", "Read"],
			{ count: ["command output", "command outputs"] },
		],
	}),
	KillShell: make({
		status: () => [["Stopping", "Stopped"], { count: ["command", "commands"] }],
	}),
	ToolSearch: make({
		status: (input: Input) => [
			["Finding", "Found"],
			{ count: ["tools", "tools"], subject: str(input.query) },
		],
	}),
};
displays.Agent = displays.Task;
displays.TaskOutput = displays.BashOutput;
displays.TaskStop = displays.KillShell;
displays.KillBash = displays.KillShell;
// Answered through the user's feedback, as Tiny Chat's own questions are.
displays.AskUserQuestion = askQuestionDisplay;

export const ClaudeCodeToolUtils = {
	/** How one of Claude Code's own tools is shown, if it is one. */
	getDisplay: (name: string): Display | undefined =>
		Object.hasOwn(displays, name) ? displays[name] : undefined,
} as const;
