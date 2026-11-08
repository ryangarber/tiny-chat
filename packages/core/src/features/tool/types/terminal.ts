import { z } from "zod";

/**
 * What to look for on the screen. Text or a pattern is matched line by line;
 * `row`/`col` pin where it starts, and with neither they name a single cell.
 * Styles hold for every cell of a match (colors and emphasis for those that
 * are not blank, the background and inverse for all of them).
 */
export const zTerminalMatch = {
	text: z.string().optional().describe("Text to find, case-sensitive."),
	regex: z
		.string()
		.optional()
		.describe("A JavaScript regular expression to find instead, per line."),
	row: z.number().int().min(1).optional().describe("Row it is on, from 1."),
	col: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Column it starts at, from 1."),
	fg: z
		.string()
		.optional()
		.describe(
			"Foreground: `default`, a name (`red`, `brightblue`), or `#rrggbb`.",
		),
	bg: z.string().optional().describe("Background, as `fg`."),
	bold: z.boolean().optional(),
	dim: z.boolean().optional(),
	italic: z.boolean().optional(),
	underline: z.boolean().optional(),
	inverse: z.boolean().optional(),
};
export type TerminalMatch = {
	[K in keyof typeof zTerminalMatch]?: z.infer<(typeof zTerminalMatch)[K]>;
};

const zModifier = z.enum(["Control", "Alt", "Shift"]);

const zSize = {
	width: z.number().int().min(10).max(500).optional(),
	height: z.number().int().min(4).max(200).optional(),
};

const zTimeout = z
	.number()
	.optional()
	.describe("Milliseconds before giving up (default 10000, max 120000).");

export const zTerminalStep = z.discriminatedUnion("action", [
	z
		.object({ action: z.literal("sessions") })
		.describe("List tmux sessions: yours to attach to, and those opened here."),
	z
		.object({
			action: z.literal("open"),
			command: z
				.string()
				.describe("What to run, as the shell would read it: `pnpm dev:cli`."),
			name: z
				.string()
				.optional()
				.describe("Session name. One opened here before is restarted."),
			cwd: z.string().optional().describe("Defaults to the shell's directory."),
			env: z.record(z.string(), z.string()).optional(),
			...zSize,
		})
		.describe(
			"Run a command in a new session (default 120×40) and make it the target. The session stays when the program exits, so its last screen and exit code can be read.",
		),
	z
		.object({ action: z.literal("close") })
		.describe("End the target session and everything running in it."),
	z
		.object({ action: z.literal("resize"), ...zSize })
		.describe("Resize the target session's screen."),
	z
		.object({
			action: z.literal("type"),
			text: z.string(),
			paste: z
				.boolean()
				.optional()
				.describe(
					"Paste it (bracketed, if the program asked) rather than type it.",
				),
		})
		.describe("Type text as it is. Use `press` for Enter and other keys."),
	z
		.object({
			action: z.literal("press"),
			keys: z
				.string()
				.describe(
					'Keys in turn, space separated: "Enter", "Down Down Tab", "Control+C", "Alt+Enter", "Shift+Tab", "F5". tmux names (`C-c`, `M-Enter`) work too.',
				),
			count: z
				.number()
				.int()
				.min(1)
				.max(200)
				.optional()
				.describe("Press them this many times over."),
		})
		.describe("Press keys and shortcuts."),
	z
		.object({
			action: z.literal("click"),
			...zTerminalMatch,
			button: z.enum(["left", "middle", "right"]).optional(),
			count: z
				.number()
				.int()
				.min(1)
				.max(3)
				.optional()
				.describe("2 for a double click."),
			modifiers: z.array(zModifier).optional(),
		})
		.describe(
			"Click the middle of the first match, or the cell at `row`/`col`. Needs a program that reads the mouse.",
		),
	z
		.object({
			action: z.literal("drag"),
			...zTerminalMatch,
			to: z
				.object(zTerminalMatch)
				.describe("Where to let go: a match, or a cell by `row`/`col`."),
			modifiers: z.array(zModifier).optional(),
		})
		.describe("Press on a match or cell, move to another, and let go."),
	z
		.object({
			action: z.literal("scroll"),
			...zTerminalMatch,
			dy: z
				.number()
				.int()
				.optional()
				.describe("Wheel notches down, negative for up (default 3)."),
			dx: z
				.number()
				.int()
				.optional()
				.describe("Notches right, negative for left."),
		})
		.describe(
			"Scroll the wheel over a match or cell, or the middle of the screen.",
		),
	z
		.object({
			action: z.literal("wait"),
			ms: z.number().optional().describe("Just sleep this long (max 60000)."),
			...zTerminalMatch,
			gone: z
				.boolean()
				.optional()
				.describe("Wait until nothing matches instead."),
			stable: z
				.number()
				.optional()
				.describe("Wait until the screen has not changed for this many ms."),
			exit: z.boolean().optional().describe("Wait for the program to exit."),
			timeout: zTimeout,
		})
		.describe(
			"Wait for a match to appear (or go), for the screen to settle, or for the program to exit. Says how long it took.",
		),
	z
		.object({
			action: z.literal("expect"),
			...zTerminalMatch,
			gone: z.boolean().optional(),
		})
		.describe(
			"Check that something is (or is not) on screen now, failing the run if not.",
		),
	z
		.object({
			action: z.literal("capture"),
			top: z
				.number()
				.int()
				.optional()
				.describe("First row to include; scrollback rows are 0 and below."),
			bottom: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("Last row to include."),
			history: z
				.number()
				.int()
				.min(1)
				.max(5000)
				.optional()
				.describe("Include this many lines of scrollback above the screen."),
			styles: z
				.boolean()
				.optional()
				.describe(
					"Also list the styled runs of text: colors and emphasis by cell.",
				),
			frames: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.describe("Capture this many times, for watching something change."),
			interval: z
				.number()
				.min(10)
				.optional()
				.describe("Milliseconds between frames (default 250)."),
		})
		.describe(
			"Capture the screen as text. Frames identical to the one before are dropped; each is timed from the step's start.",
		),
]);
export type zTerminalStep = z.infer<typeof zTerminalStep>;

export const zTerminalStepResult = z.object({
	action: z.string(),
	ok: z.boolean(),
	value: z.unknown().optional(),
	error: z.string().optional(),
});
export type zTerminalStepResult = z.infer<typeof zTerminalStepResult>;

export const zTerminalSession = z.object({
	name: z.string(),
	width: z.number(),
	height: z.number(),
	/** What its active pane is running. */
	command: z.string().optional(),
	/** Set once the program has exited, to its exit status. */
	exited: z.number().optional(),
	/** Whether someone is watching it. */
	attached: z.boolean().optional(),
	/** Whether it was opened by this tool. */
	opened: z.boolean().optional(),
	/** How to watch it from a terminal. */
	attach: z.string(),
});
export type zTerminalSession = z.infer<typeof zTerminalSession>;

/** A screen as captured, its rows as they were drawn. */
export const zTerminalScreen = z.object({
	session: z.string(),
	width: z.number(),
	height: z.number(),
	/** 1-based, as rows and columns are everywhere else. */
	cursor: z.object({ row: z.number(), col: z.number() }).optional(),
	/** Rows from `top` on; scrollback rows above the screen are numbered 0 and below. */
	top: z.number(),
	/** Milliseconds into the step it was captured. */
	at: z.number().optional(),
	lines: z.array(z.string()),
});
export type zTerminalScreen = z.infer<typeof zTerminalScreen>;

export const zTerminalRunResult = z.object({
	session: zTerminalSession.optional(),
	steps: z.array(zTerminalStepResult),
	/** Steps never reached because one before them failed or was aborted. */
	skipped: z.number().optional(),
	/** Every captured screen, in order; steps refer to them by index. */
	screens: z.array(zTerminalScreen),
});
export type zTerminalRunResult = z.infer<typeof zTerminalRunResult>;

/** One cell's look, in the terms matches use. */
export interface TerminalStyle {
	fg: string;
	bg: string;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	inverse: boolean;
}

export interface TerminalCell extends TerminalStyle {
	/** Empty for the second half of a wide character. */
	char: string;
}
