import {
	type TerminalScreen,
	type TerminalStep,
	zStepResult,
	zTerminalScreen,
	zTerminalSession,
	zTerminalStep,
} from "computah/schema";
import { z } from "zod";
import type {
	ShellCapability,
	TerminalCapability,
} from "#core/core/types/capability.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";

export const terminal = {
	name: "terminal",
	description: `Run and drive interactive terminal programs — TUIs, REPLs, anything that draws a screen or waits on keys — in tmux sessions on the user's machine. Runs \`steps\` in order and stops at the first that fails; sessions and the target carry over between calls, and the user can watch one with its \`attach\` command.

\`open\` a command to start a session, then chain what you can predict in one call: type, press, click, wait, capture. Rows and columns count from 1. Find things by \`text\` or \`regex\`, optionally with a style (\`fg\`, \`bg\`, \`bold\`, …) or pinned to a \`row\`/\`col\`, or with a \`selector\` that says it all at once (\`"ERR"[fg=red][bold]\`); mouse steps act on the middle of the first match. Wait for what you expect rather than sleeping, and \`capture\` (or set \`capture\`) to see the screen. Screens follow the result as text, in the order \`screens\` lists them, one line per row; a failed wait or match adds the screen it gave up on. Use \`shell_exec\` for commands that just print and exit.`,
	input: z.object({
		session: z
			.string()
			.optional()
			.describe("The session to act on. Defaults to the last one used."),
		steps: z.array(zTerminalStep).min(1),
		capture: z
			.boolean()
			.optional()
			.describe("Capture the target's screen after the steps run."),
	}),
	output: z.object({
		session: zTerminalSession.optional(),
		steps: z.array(zStepResult),
		skipped: z.number().optional(),
		notice: z.string().optional(),
		/** Each screen captured, whose text follows the result in order. */
		screens: z
			.array(
				zTerminalScreen.omit({ lines: true, top: true }).extend({
					screen: z.number(),
					rows: z.string(),
				}),
			)
			.optional(),
	}),
} as const satisfies ToolDefinition;

/** `open pnpm dev:cli, wait "Ready", press Alt+Enter` */
const getSummary = (steps: Partial<TerminalStep>[] = []) =>
	steps
		.map((step) => {
			if (!step?.action) return "";
			const detail =
				step.action === "open"
					? step.command
					: step.action === "press"
						? step.keys
						: step.action === "type"
							? JSON.stringify(step.text ?? "")
							: "text" in step && step.text !== undefined
								? JSON.stringify(step.text)
								: "regex" in step && step.regex
									? `/${step.regex}/`
									: "";
			return [step.action, detail].filter(Boolean).join(" ");
		})
		.filter(Boolean)
		.join(", ");

/**
 * What a screen was, told apart from its text: the text follows as it is, so
 * its line numbers are the screen's rows.
 */
const describeScreen = (
	{ lines, top, ...screen }: TerminalScreen,
	index: number,
) => ({
	screen: index + 1,
	...screen,
	rows: `${top}–${top + Math.max(lines.length, 1) - 1}`,
});

const display: ToolDisplay<typeof terminal> = {
	status: ({ input }) => [
		["Performing", "Performed"],
		{
			count: ["terminal action", "terminal actions"],
			subject: getSummary(input.steps as Partial<TerminalStep>[]),
		},
	],
	input: ({ input }) => [
		{
			type: "code",
			language: "json",
			value: [
				...(input.session ? [JSON.stringify({ session: input.session })] : []),
				...(input.steps ?? []).map((step) => JSON.stringify(step)),
			].join("\n"),
		},
	],
	output: ({ output }) => {
		const [result] = output;
		if (!result) return [];
		return [
			{
				type: "json",
				title: result.session
					? `${result.session.name} — ${result.session.attach}`
					: undefined,
				value: result.steps,
			},
		];
	},
	text: { title: "screen" },
};

/**
 * Sessions start where the user's shell is, unless a step says otherwise:
 * the host running tmux does not know where that is.
 */
const withCwd = (steps: TerminalStep[], cwd: string | undefined) =>
	cwd
		? steps.map((step) =>
				step.action === "open" && !step.cwd ? { ...step, cwd } : step,
			)
		: steps;

export const createTerminalTool: ToolFactory<
	Tool<
		typeof terminal,
		{ terminal: TerminalCapability; shell?: ShellCapability }
	>
> = (options) => ({
	...terminal,
	...options,
	display,
	// Steps act on whichever session is the target, which a call can change.
	sequential: true,
	validate: async ({ input, context }) => {
		const { terminal, shell } = options.capabilities;
		const { commands, folders } = SettingsUtils.of(
			context.user,
			context.chat?.project,
		);
		const cwd = await shell?.cwd?.().catch(() => undefined);
		const unsafe = input.steps.some(
			(step) =>
				step.action === "open" &&
				!ShellUtils.isSafe(step.command, commands, {
					folders: shell ? ShellUtils.toShellFolders(shell, folders) : [],
					cwd: step.cwd ?? cwd,
					dialect: "bash",
				}),
		);
		return {
			approval:
				unsafe ||
				(await terminal.touchesForeign({
					session: input.session,
					steps: input.steps,
				})),
		};
	},
	execute: async ({ input, abort }) => {
		const { terminal, shell } = options.capabilities;
		const cwd = await shell?.cwd?.().catch(() => undefined);
		const { screens, ...result } = await terminal.run({
			session: input.session,
			steps: withCwd(input.steps, cwd),
			capture: input.capture,
			abort,
		});
		return [
			{
				type: "json",
				value: {
					...result,
					...(screens.length ? { screens: screens.map(describeScreen) } : {}),
				},
			},
			...screens.map((screen) => ({
				type: "text" as const,
				value: screen.lines.join("\n"),
			})),
		];
	},
});
