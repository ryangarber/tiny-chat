import { z } from "zod";
import type { Capabilities } from "#core/core/types/capability.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import { ShellExecService } from "#core/features/tool/services/ShellExecService.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

const MNT_DESCRIPTION = `MUST set to TRUE any time the command should run in the virtual \`${PathUtils.mount}\` filesystem.`;

const BACKGROUND_DESCRIPTION =
	"Set to TRUE to run the command in the background and carry on working meanwhile. Its result is sent to you when it finishes, and your turn does not end until then.";

export const shell_exec = {
	name: "shell_exec",
	description:
		"Execute a shell command. Prefer the dedicated file tools for reading, searching and editing; use this for builds, tests, version control and anything else they do not cover. Long output is truncated in the middle, so pipe through a filter when you need all of it.",
	input: z.object({
		command: z.string(),
		mnt: z.boolean().describe(MNT_DESCRIPTION),
		background: z
			.boolean()
			.optional()
			.describe(
				`${BACKGROUND_DESCRIPTION} Use it for long builds and test runs, not for commands that never exit, like servers.`,
			),
	}),
	output: z.object({
		code: z.number().optional(),
		stdout: z.string(),
		stderr: z.string(),
		/** How the command was read, for showing it; unset means bash. */
		dialect: z.enum(["bash", "powershell"]).optional(),
	}),
	stream: z.object({
		type: z.enum(["stdout", "stderr"]),
		value: z.string(),
	}),
} as const satisfies ToolDefinition;

const display: ToolDisplay<typeof shell_exec> = {
	status: ({ input }) => ToolDisplayUtils.status.command(input.command),
	input: ({ input, output }) => [
		ToolDisplayUtils.command(input.command, output[0]?.dialect),
	],
	output: ({ state, output, stream }) => {
		if (state === "running") {
			return [
				{
					type: "code",
					value: stream.map((line) => line.value).join("\n"),
					title: "output",
					terminal: true,
				},
			];
		}
		const [result] = output;
		return result ? ToolDisplayUtils.commandOutput(result) : [];
	},
};

export const createShellExecTool: ToolFactory<
	Tool<typeof shell_exec, Pick<Capabilities, "shell" | "chatShell">>
> = (options) => ({
	...shell_exec,
	...options,
	display,
	background: true,
	tracksChanges: true,
	validate: async ({ input, context }) => {
		const { commands, folders } = SettingsUtils.of(
			context.user,
			context.chat?.project,
		);
		// Folders live on the user's machine, not in the virtual filesystem.
		const shell = input.mnt ? undefined : options.capabilities.shell;
		const cwd = await shell?.cwd?.().catch(() => undefined);
		return {
			approval: !ShellUtils.isSafe(input.command, commands, {
				folders: shell ? ShellUtils.toShellFolders(shell, folders) : [],
				cwd,
				dialect: shell?.environment?.().dialect,
			}),
		};
	},
	execute: async ({ input, stream, abort }) => [
		{
			type: "json",
			value: await ShellExecService.exec({
				shell: ShellUtils.detect(input.mnt, options.capabilities),
				command: input.command,
				stream,
				abort,
			}),
		},
	],
});
