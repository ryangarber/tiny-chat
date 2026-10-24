import { z } from "zod";

/**
 * What an element step acts on: a `ref` from a `read` outline, or `x`/`y`
 * pixels in the latest screenshot. A ref is the more precise of the two, and
 * acts on the element itself where the app allows, without moving the pointer.
 */
const zTarget = {
	ref: z
		.string()
		.optional()
		.describe("An element ref from a `read` outline, e.g. `e12`."),
	x: z.number().optional().describe("x in the latest screenshot's pixels."),
	y: z.number().optional().describe("y in the latest screenshot's pixels."),
};

const zFind = z
	.string()
	.describe(
		"Case-insensitive text to look for in elements' role, name, value or description.",
	);

const zModifier = z.enum(["Alt", "Control", "Meta", "Shift", "Mod"]);

export const zComputerStep = z.discriminatedUnion("action", [
	z
		.object({ action: z.literal("windows") })
		.describe("List open windows with their ids (`w3`) and apps."),
	z
		.object({
			action: z.literal("open"),
			app: z
				.string()
				.describe(
					"An app name (`Calculator`, `gnome-calculator`), or a path to an app or file.",
				),
			args: z.array(z.string()).optional(),
			timeout: z
				.number()
				.optional()
				.describe("How long to wait for its window (default 15000)."),
		})
		.describe(
			"Open an app or file, or bring it forward if one of its windows is already open, and make its window the target.",
		),
	z
		.object({
			action: z.literal("read"),
			ref: z
				.string()
				.optional()
				.describe("Read only this element and what it contains."),
			find: zFind
				.optional()
				.describe(
					"Show only matching elements and the elements that contain them.",
				),
			depth: z.number().optional().describe("Levels to read (default 40)."),
			maxLength: z
				.number()
				.optional()
				.describe("Cap on characters returned (default 20000)."),
		})
		.describe(
			"Read the target window's accessibility outline, with refs to act on.",
		),
	z
		.object({
			action: z.literal("click"),
			...zTarget,
			button: z.enum(["left", "right", "middle"]).optional(),
			count: z.number().optional().describe("2 for a double click."),
			modifiers: z.array(zModifier).optional(),
		})
		.describe("Click an element by ref, or a point by x/y."),
	z
		.object({
			action: z.literal("type"),
			text: z.string(),
			ref: z.string().optional(),
			clear: z
				.boolean()
				.optional()
				.describe(
					"With a ref, replace its value (default true) rather than type after it.",
				),
			submit: z.boolean().optional().describe("Press Enter afterwards."),
		})
		.describe("Type text into the field by ref, or into whatever has focus."),
	z
		.object({
			action: z.literal("press"),
			keys: z
				.string()
				.describe(
					'Keys to press in turn, space separated: "Enter", "Tab Tab Enter", "Control+A Backspace". `Mod` is Command on macOS and Control elsewhere.',
				),
		})
		.describe("Press keys or shortcuts in the focused window."),
	z
		.object({
			action: z.literal("scroll"),
			...zTarget,
			dx: z.number().optional(),
			dy: z
				.number()
				.optional()
				.describe("Wheel notches down (negative for up). Default 5."),
		})
		.describe(
			"Scroll at an element or point. A ref with no dx/dy is scrolled into view instead.",
		),
	z
		.object({
			action: z.literal("drag"),
			...zTarget,
			toRef: z.string().optional(),
			toX: z.number().optional(),
			toY: z.number().optional(),
		})
		.describe("Drag from an element or point to another."),
	z
		.object({
			action: z.literal("wait"),
			ms: z.number().optional().describe("Sleep this long (max 30000)."),
			find: zFind
				.optional()
				.describe("Wait until an element matching this appears."),
			gone: z
				.boolean()
				.optional()
				.describe("With `find`, wait until nothing matches instead."),
			timeout: z.number().optional().describe("Default 10000, max 60000."),
		})
		.describe("Wait for time, or for an element to appear or disappear."),
	z
		.object({
			action: z.literal("screenshot"),
			screen: z
				.boolean()
				.optional()
				.describe("The whole screen rather than the target window."),
			ref: z.string().optional().describe("Zoom in on this element."),
			region: z
				.object({
					x: z.number(),
					y: z.number(),
					width: z.number(),
					height: z.number(),
				})
				.optional()
				.describe("Zoom in on this rectangle of the latest screenshot."),
		})
		.describe(
			"Capture the target window, the screen, or part of either; later x/y are this image's pixels.",
		),
	z
		.object({
			action: z.literal("window"),
			op: z.enum([
				"activate",
				"minimize",
				"maximize",
				"restore",
				"close",
				"move",
				"resize",
			]),
			x: z.number().optional(),
			y: z.number().optional(),
			width: z.number().optional(),
			height: z.number().optional(),
		})
		.describe(
			"Bring forward, minimize, maximize, restore, close, move or resize the target window.",
		),
]);
export type zComputerStep = z.infer<typeof zComputerStep>;

export const zComputerStepResult = z.object({
	action: z.string(),
	ok: z.boolean(),
	value: z.unknown().optional(),
	error: z.string().optional(),
});
export type zComputerStepResult = z.infer<typeof zComputerStepResult>;

export const zComputerRunResult = z.object({
	/** The window the steps ended on, when there was one. */
	window: z
		.object({ id: z.string(), app: z.string(), title: z.string().optional() })
		.optional(),
	steps: z.array(zComputerStepResult),
	/** Steps never reached because one before them failed or was aborted. */
	skipped: z.number().optional(),
	/** One per `screenshot` step, then the final one when asked for. */
	screenshots: z.array(z.object({ mime: z.string(), data: z.string() })),
});
export type zComputerRunResult = z.infer<typeof zComputerRunResult>;

/** Whether the host can control the computer, and what is missing if not. */
export const zComputerStatus = z.object({
	available: z.boolean(),
	error: z.string().optional(),
	os: z.string().optional(),
	/** Whether pointer and keyboard input can be synthesised (not on Wayland). */
	input: z.boolean().optional(),
	/** Permissions the user still has to grant: `accessibility`, `screen`. */
	missing: z.array(z.string()).optional(),
});
export type zComputerStatus = z.infer<typeof zComputerStatus>;

// ── The host library's protocol (`ComputerHostService`, over xa11y) ─────────────────────────

export const zComputerRect = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});
export type zComputerRect = z.infer<typeof zComputerRect>;

export const zComputerResponse = z.union([
	z.object({ ok: z.literal(true), result: z.unknown() }),
	z.object({
		ok: z.literal(false),
		error: z.object({ code: z.string(), message: z.string() }),
	}),
]);

export const zComputerLibraryStatus = z.object({
	os: z.string(),
	pid: z.number(),
	input: z.boolean(),
	missing: z.array(z.string()),
	errors: z.record(z.string(), z.string()),
});
export type zComputerLibraryStatus = z.infer<typeof zComputerLibraryStatus>;

export const zComputerWindow = z.object({
	id: z.number(),
	pid: z.number().nullish(),
	app: z.string(),
	title: z.string().nullish(),
	bounds: zComputerRect.nullish(),
	focused: z.boolean(),
	minimized: z.boolean().nullish(),
});
export type zComputerWindow = z.infer<typeof zComputerWindow>;

export const zComputerNode = z.object({
	handle: z.number(),
	parent: z.number().nullable(),
	role: z.string(),
	name: z.string().optional(),
	value: z.string().optional(),
	description: z.string().optional(),
	stableId: z.string().optional(),
	bounds: zComputerRect.optional(),
	actions: z.array(z.string()).optional(),
	states: z.array(z.string()).optional(),
});
export type zComputerNode = z.infer<typeof zComputerNode>;

export const zComputerTree = z.object({
	nodes: z.array(zComputerNode),
	truncated: z.boolean(),
});
export type zComputerTree = z.infer<typeof zComputerTree>;

export const zComputerCapture = z.object({
	frame: z.number(),
	mime: z.string(),
	data: z.string(),
	width: z.number(),
	height: z.number(),
});
export type zComputerCapture = z.infer<typeof zComputerCapture>;

/** One synthesised input event; points are desktop coordinates unless a `frame` is given. */
export type ComputerInputEvent =
	| { type: "move"; x: number; y: number }
	| {
			type: "click";
			x: number;
			y: number;
			button?: "left" | "right" | "middle";
			count?: number;
			modifiers?: string[];
	  }
	| {
			type: "drag";
			x: number;
			y: number;
			toX: number;
			toY: number;
			modifiers?: string[];
	  }
	| { type: "scroll"; x: number; y: number; dx: number; dy: number }
	| { type: "key"; key: string; modifiers?: string[] }
	| { type: "text"; text: string };
