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
	/** Whether it can change files, which are then found and shown as diffs. */
	tracksChanges?: boolean;
	/** How the text of its result is shown, as with Claude Code's own tools. */
	text?: { prose?: boolean; title?: string };
};

/** A display read from the call's input alone, which is all these need. */
const make = ({
	status,
	input,
	text,
	tracksChanges,
}: {
	status: (input: Input) => ToolStatusPiece[];
	input?: (input: Input) => ToolBlock[];
	text?: Display["text"];
	tracksChanges?: boolean;
}): Display => ({
	status: (call) => status((call.input ?? {}) as Input),
	input: input && ((call) => input((call.input ?? {}) as Input)),
	text,
	tracksChanges,
});

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** What Codex runs a command as: `zsh -lc '…'`, shown as the command. */
const command = (input: Input) => {
	const value = str(input.command);
	const match = /^\S*(?:ba|z)?sh\s+-l?c\s+'([\s\S]*)'$/.exec(value);
	return match ? match[1].replace(/'\\''/g, "'") : value;
};

const changes = (input: Input): Input[] =>
	Array.isArray(input.changes) ? input.changes : [];

/**
 * One file of a patch as a diff: an update's hunks read back into the lines
 * before and after it, an added or deleted file's contents whole.
 */
const patchDiff = (change: Input): ToolBlock => {
	const path = str(change?.path);
	const diff = str(change?.diff);
	const kind = str(change?.kind?.type);
	const before: string[] = [];
	const after: string[] = [];
	if (kind === "add") after.push(diff);
	else if (kind === "delete") before.push(diff);
	else {
		let hunk = false;
		for (const line of diff.replace(/\n$/, "").split("\n")) {
			if (line.startsWith("@@")) {
				hunk = true;
				continue;
			}
			// File headers come before the first hunk; `\ No newline` anywhere.
			if ((!hunk && /^(---|\+\+\+) /.test(line)) || line.startsWith("\\"))
				continue;
			const text = line.slice(1);
			if (line.startsWith("-")) before.push(text);
			else if (line.startsWith("+")) after.push(text);
			else {
				before.push(text);
				after.push(text);
			}
		}
	}
	return {
		type: "diff",
		path,
		before: before.join("\n"),
		after: after.join("\n"),
		language: ToolDisplayUtils.language(path),
	};
};

/** A subagent, shown as Claude Code's are: its prompt, then its conversation. */
const subagent: Display = {
	...make({
		status: (input: Input) => [
			["Using", "Used"],
			{
				count: ["subagent", "subagents"],
				subject: str(input.agentPath).split("/").at(-1) ?? "",
			},
		],
		input: (input: Input) => {
			const prompt = str(input.message) || str(input.prompt);
			return prompt ? [{ type: "markdown", value: prompt, quote: true }] : [];
		},
	}),
	output: ({ state, stream }) => {
		const data = state === "running" ? stream.at(-1) : undefined;
		return data ? [{ type: "messages", data: data as zData }] : [];
	},
	text: { prose: true },
};

/**
 * How Codex's own tools are shown, in the look of their Tiny Chat
 * counterparts. Their results are mostly text, which every call shows as is.
 */
const displays: Record<string, Display> = {
	exec_command: make({
		tracksChanges: true,
		status: (input: Input) => [
			["Running", "Ran"],
			{
				count: ["command", "commands"],
				subject: ShellUtils.programs(command(input)),
			},
		],
		input: (input: Input) => [
			{ type: "code", value: command(input), language: "bash", title: "input" },
		],
		text: { title: "output" },
	}),
	apply_patch: make({
		tracksChanges: true,
		status: (input: Input) => {
			const files = changes(input);
			return [
				["Editing", "Edited"],
				{
					count: ["file", "files"],
					subject:
						files.length === 1
							? ToolDisplayUtils.name(str(files[0]?.path))
							: `${files.length} files`,
				},
			];
		},
		input: (input: Input) => changes(input).map(patchDiff),
	}),
	web_search: make({
		status: (input: Input) => [
			["Searching", "Searched"],
			"web for",
			{ count: ["query", "queries"], subject: str(input.query) },
		],
	}),
	view_image: {
		...make({
			status: (input: Input) => [
				["Viewing", "Viewed"],
				{ count: ["image", "images"] },
				{ subject: ToolDisplayUtils.name(str(input.path)) },
			],
		}),
		output: ({ input, files }) =>
			files.flatMap(
				(file) =>
					ToolDisplayUtils.file({ path: str((input as Input).path), file }) ??
					[],
			),
	},
	image_generation: make({
		status: (input: Input) => [
			["Generating", "Generated"],
			{ count: ["image", "images"], subject: str(input.prompt) },
		],
	}),
	spawn_agent: subagent,
	wait_agent: make({
		status: () => [
			["Waiting on", "Waited on"],
			{ count: ["subagent", "subagents"] },
		],
	}),
	send_message: make({
		status: () => [
			["Messaging", "Messaged"],
			{ count: ["subagent", "subagents"] },
		],
	}),
	followup_task: make({
		status: () => [
			["Messaging", "Messaged"],
			{ count: ["subagent", "subagents"] },
		],
	}),
	interrupt_agent: make({
		status: () => [
			["Stopping", "Stopped"],
			{ count: ["subagent", "subagents"] },
		],
	}),
	close_agent: make({
		status: () => [["Closing", "Closed"], { count: ["subagent", "subagents"] }],
	}),
	list_agents: make({
		status: () => [
			["Listing", "Listed"],
			{ count: ["subagents", "subagents"] },
		],
	}),
	sleep: make({ status: () => [["Waiting", "Waited"]] }),
	// Answered through the user's feedback, as Tiny Chat's own questions are.
	request_user_input: askQuestionDisplay,
};

export const CodexToolUtils = {
	/** How one of Codex's own tools is shown, if it is one. */
	getDisplay: (name: string): Display | undefined =>
		Object.hasOwn(displays, name) ? displays[name] : undefined,
} as const;
