import { askQuestionDisplay } from "#core/features/tool/tools/questions/ask_question.ts";
import {
	type AgentToolDisplay,
	type AgentToolInput,
	AgentToolUtils,
} from "#core/features/tool/utils/AgentToolUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

const { make, str } = AgentToolUtils;

const diff = (input: AgentToolInput, before: unknown, after: unknown) =>
	ToolDisplayUtils.diff({
		path: str(input.file_path),
		before: str(before),
		after: str(after),
	});

const edit = (input: AgentToolInput) =>
	ToolDisplayUtils.status.paths({
		verb: ["Editing", "Edited"],
		paths: [str(input.file_path)],
	});

/**
 * How Claude Code's own tools are shown, in the look of their Tiny Chat
 * counterparts. Their results are mostly text, which every call shows as is;
 * the images and documents `Read` takes in are shown as files.
 */
const displays: Record<string, AgentToolDisplay> = {
	Bash: AgentToolUtils.command((input) => str(input.command)),
	Read: AgentToolUtils.read((input) => str(input.file_path)),
	Write: make({
		tracksChanges: true,
		status: (input) =>
			ToolDisplayUtils.status.paths({
				verb: ["Writing", "Wrote"],
				paths: [str(input.file_path)],
			}),
		input: (input) => [
			ToolDisplayUtils.text({
				path: str(input.file_path),
				content: str(input.content),
			}),
		],
	}),
	Edit: make({
		tracksChanges: true,
		status: edit,
		input: (input) => [diff(input, input.old_string, input.new_string)],
	}),
	MultiEdit: make({
		tracksChanges: true,
		status: edit,
		input: (input) =>
			(Array.isArray(input.edits) ? input.edits : []).map(
				(item: AgentToolInput) =>
					diff(input, item?.old_string, item?.new_string),
			),
	}),
	Glob: make({
		status: (input) =>
			ToolDisplayUtils.status.glob(str(input.pattern), str(input.path)),
	}),
	Grep: make({
		status: (input) =>
			ToolDisplayUtils.status.grep(str(input.pattern), str(input.path)),
	}),
	WebSearch: make({
		status: (input) => ToolDisplayUtils.status.searchWeb(str(input.query)),
	}),
	WebFetch: make({
		status: (input) => ToolDisplayUtils.status.viewWeb(str(input.url)),
	}),
	TodoWrite: AgentToolUtils.todos((input) => input.todos),
	Task: AgentToolUtils.subagent({
		task: (input) => str(input.description),
		prompt: (input) => str(input.prompt),
	}),
	NotebookEdit: make({
		tracksChanges: true,
		status: (input) =>
			ToolDisplayUtils.status.paths({
				verb: ["Editing", "Edited"],
				paths: [str(input.notebook_path)],
				count: ["notebook", "notebooks"],
			}),
		input: (input) => [
			{
				type: "code",
				value: str(input.new_source),
				language: input.cell_type === "markdown" ? "markdown" : "python",
			},
		],
	}),
	ExitPlanMode: AgentToolUtils.plan((input) => str(input.plan)),
	EnterPlanMode: make({
		status: () => [["Planning", "Planned"]],
	}),
	Skill: make({
		status: (input) => [
			["Using", "Used"],
			{ count: ["skill", "skills"], subject: str(input.skill) },
		],
	}),
	BashOutput: make({
		status: () => [
			["Reading", "Read"],
			{ count: ["command output", "command outputs"] },
		],
		text: { title: "output", terminal: true },
	}),
	KillShell: make({
		status: () => [["Stopping", "Stopped"], { count: ["command", "commands"] }],
	}),
	ToolSearch: make({
		status: (input) => [
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
	getDisplay: (name: string): AgentToolDisplay | undefined =>
		Object.hasOwn(displays, name) ? displays[name] : undefined,
} as const;
