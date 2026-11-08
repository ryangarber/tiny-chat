import type { ToolBlock } from "#core/features/tool/types/display.ts";
import {
	type AgentToolDisplay,
	type AgentToolInput,
	AgentToolUtils,
} from "#core/features/tool/utils/AgentToolUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

const { make, str } = AgentToolUtils;

const onPath = (verb: [string, string]) => (input: AgentToolInput) =>
	ToolDisplayUtils.status.paths({ verb, paths: [str(input.path)] });

/**
 * How Cursor's own tools are shown, in the look of their Tiny Chat
 * counterparts. `CursorProvider` turns their results into the parts those
 * tools return, so most are drawn by the same blocks; the text left beside
 * them is a notice, such as how much of a listing was shown.
 */
const displays: Record<string, AgentToolDisplay> = {
	shell: {
		...AgentToolUtils.command((input) => str(input.command)),
		output: ({ output }) =>
			output.flatMap((result) =>
				ToolDisplayUtils.commandOutput(result as AgentToolInput),
			),
		text: "notice",
	},
	read: make({
		status: onPath(["Reading", "Read"]),
		output: ({ input, output }) =>
			output.map((read) =>
				ToolDisplayUtils.text({
					path: str(input.path),
					content: str((read as AgentToolInput)?.content),
				}),
			),
		text: "notice",
	}),
	write: make({
		tracksChanges: true,
		status: onPath(["Writing", "Wrote"]),
		input: (input) => [
			ToolDisplayUtils.text({
				path: str(input.path),
				content: str(input.fileText),
			}),
		],
	}),
	// Its edit is not in its input: the diff found beside it shows it.
	edit: make({ tracksChanges: true, status: onPath(["Editing", "Edited"]) }),
	delete: make({
		tracksChanges: true,
		status: onPath(["Deleting", "Deleted"]),
	}),
	glob: make({
		status: (input) =>
			ToolDisplayUtils.status.glob(
				str(input.globPattern),
				str(input.targetDirectory),
			),
		output: ({ input, output }) =>
			ToolDisplayUtils.directory({
				path: str(input.targetDirectory),
				entries: output.map(str),
			}),
		text: "notice",
	}),
	grep: make({
		status: (input) =>
			ToolDisplayUtils.status.grep(str(input.pattern), str(input.path)),
		// Matching lines by file, as `search_files` shows them, or only the files.
		output: ({ input, output }): ToolBlock[] => [
			...output.flatMap((item) =>
				item && typeof item === "object"
					? [
							ToolDisplayUtils.text({
								path: str((item as AgentToolInput).path),
								content: str((item as AgentToolInput).snippet),
							}),
						]
					: [],
			),
			...ToolDisplayUtils.directory({
				path: str(input.path),
				entries: output.filter((item) => typeof item === "string"),
			}),
		],
	}),
	ls: make({
		status: (input) =>
			ToolDisplayUtils.status.paths({
				verb: ["Browsing", "Browsed"],
				paths: [str(input.path)],
				count: ["folder", "folders"],
			}),
		output: ({ input, output }) =>
			ToolDisplayUtils.directory({
				path: str(input.path),
				entries: output as AgentToolInput[],
			}),
		text: "notice",
	}),
	semSearch: make({
		status: (input) => ToolDisplayUtils.status.searchFiles(str(input.query)),
	}),
	readLints: make({
		status: (input) => [
			...ToolDisplayUtils.status.paths({
				verb: ["Checking", "Checked"],
				paths: Array.isArray(input.paths) ? input.paths.map(str) : [],
			}),
			"for problems",
		],
	}),
	updateTodos: AgentToolUtils.todos((input) => input.todos),
	createPlan: AgentToolUtils.plan((input) => str(input.plan)),
	task: AgentToolUtils.subagent({
		task: (input) => str(input.description),
		prompt: (input) => str(input.prompt),
	}),
	generateImage: AgentToolUtils.image({
		prompt: (input) => str(input.description),
		path: (input) => str(input.filePath),
	}),
	// Another MCP server's tool, through Cursor.
	mcp: make({
		tracksChanges: true,
		status: (input) => [
			["Using", "Used"],
			{ count: ["tool", "tools"], subject: str(input.toolName) },
		],
		input: (input) =>
			input.args && Object.keys(input.args).length
				? [{ type: "json", value: input.args, title: "Input" }]
				: [],
	}),
	computerUse: make({
		status: (input) => [
			["Performing", "Performed"],
			{
				count: ["action", "actions"],
				subject:
					str(input.description) ||
					(Array.isArray(input.actions)
						? input.actions
								.map((action: AgentToolInput) => str(action?.type))
								.join(", ")
						: ""),
			},
		],
	}),
	recordScreen: make({
		status: () => [["Recording", "Recorded"], { count: ["screen", "screens"] }],
	}),
};

export const CursorToolUtils = {
	/** How one of Cursor's own tools is shown, if it is one. */
	getDisplay: (name: string): AgentToolDisplay | undefined =>
		Object.hasOwn(displays, name) ? displays[name] : undefined,
} as const;
