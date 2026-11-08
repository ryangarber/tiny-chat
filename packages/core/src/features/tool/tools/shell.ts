import type { Capabilities } from "#core/core/types/capability.ts";
import { TerminalService } from "#core/features/tool/services/TerminalService.ts";
import { createEditFilesTool } from "#core/features/tool/tools/shell/edit_files.ts";
import { createGlobFilesTool } from "#core/features/tool/tools/shell/glob_files.ts";
import { createReadFilesTool } from "#core/features/tool/tools/shell/read_files.ts";
import { createSearchFilesTool } from "#core/features/tool/tools/shell/search_files.ts";
import { createShellExecTool } from "#core/features/tool/tools/shell/shell_exec.ts";
import { createTerminalTool } from "#core/features/tool/tools/shell/terminal.ts";
import type {
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";

export const createShellToolset: ToolsetFactory<
	Toolset<Pick<Capabilities, "shell" | "chatShell">>
> = async (options) => {
	// Interactive programs run in tmux, which only the user's own shell has.
	const shell = options.capabilities.shell;
	const terminal =
		shell && (await TerminalService.available(shell))
			? [await createTerminalTool({ ...options, capabilities: { shell } })]
			: [];

	return {
		name: "shell",
		tools: [
			await createReadFilesTool(options),
			await createGlobFilesTool(options),
			await createSearchFilesTool(options),
			await createEditFilesTool(options),
			await createShellExecTool(options),
			...terminal,
		],
		...options,
		instructions: [
			options.instructions,
			"Look before you change anything: read a file before editing it, check before overwriting or deleting, and batch independent reads and searches into one turn. When working on a coding task, read the relevant code and any project guidance first and follow the conventions you find. Make the change, add or update tests where the project has them, then run its own lint, type-check/build and test commands. Fix failures your change caused and rerun; report anything you couldn't run or that still fails.",
			"On multi-step work, give a short update at natural milestones (what you found, what you're changing, what's left) instead of working silently through many calls or narrating each one, and end with a brief summary of what changed and how you verified it.",
			terminal.length
				? "For programs that need a live terminal — TUIs, REPLs, prompts, anything you have to type into or watch — use `terminal` rather than `shell_exec` or tmux by hand. When you open a session the user may want to watch, tell them its attach command."
				: "",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
};
