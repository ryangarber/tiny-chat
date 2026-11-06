import { z } from "zod";

/**
 * What an element step acts on. A `ref` comes from a `read` tree and is the
 * most precise; a `selector` is any Playwright selector (`css`, `text=`,
 * `role=button[name="Save"]`) and survives navigation, which is what makes it
 * the one to use in a chain written before the page has been read; `x`/`y` are
 * CSS pixels in the viewport, the same pixels a screenshot is taken in.
 */
const zTarget = {
	ref: z
		.string()
		.optional()
		.describe("An element ref from a `read` tree, e.g. `e12`."),
	selector: z
		.string()
		.optional()
		.describe(
			'A Playwright selector: CSS, `text=Sign in`, `role=button[name="Save"]`.',
		),
};

const zPoint = {
	x: z.number().optional().describe("Viewport x in CSS pixels."),
	y: z.number().optional().describe("Viewport y in CSS pixels."),
};

export const zBrowserStep = z.discriminatedUnion("action", [
	z
		.object({
			action: z.literal("navigate"),
			url: z.string().describe('A URL, or "back", "forward" or "reload".'),
		})
		.describe("Go to a URL, or move through history."),
	z
		.object({
			action: z.literal("read"),
			format: z
				.enum(["tree", "text", "html"])
				.optional()
				.describe(
					"`tree` (default): visible elements with refs for interacting. `text`: rendered text. `html`: markup.",
				),
			...zTarget,
			maxLength: z
				.number()
				.optional()
				.describe("Cap on characters returned (default 20000)."),
		})
		.describe("Read the page, or only the element targeted."),
	z
		.object({
			action: z.literal("click"),
			...zTarget,
			...zPoint,
			button: z.enum(["left", "right", "middle"]).optional(),
			count: z.number().optional().describe("2 for a double click."),
			modifiers: z
				.array(z.enum(["Alt", "Control", "Meta", "Shift"]))
				.optional(),
		})
		.describe("Click an element by ref or selector, or a point by x/y."),
	z
		.object({
			action: z.literal("hover"),
			...zTarget,
			...zPoint,
		})
		.describe("Move the mouse over an element or point."),
	z
		.object({
			action: z.literal("type"),
			text: z.string(),
			...zTarget,
			clear: z
				.boolean()
				.optional()
				.describe(
					"With a target, replace its value (default true) rather than type after it. A <select> is set to the matching option.",
				),
			submit: z.boolean().optional().describe("Press Enter afterwards."),
		})
		.describe("Type text into the targeted field, or into whatever has focus."),
	z
		.object({
			action: z.literal("press"),
			keys: z
				.string()
				.describe(
					'Keys to press in turn, space separated: "Enter", "Tab Tab Enter", "Control+A Backspace", "Meta+L".',
				),
		})
		.describe("Press keys or shortcuts."),
	z
		.object({
			action: z.literal("scroll"),
			...zTarget,
			...zPoint,
			dx: z.number().optional(),
			dy: z
				.number()
				.optional()
				.describe("Pixels to scroll down (negative for up). Default 600."),
		})
		.describe(
			"Scroll a target into view, or scroll the page (or the point x/y) by dx/dy.",
		),
	z
		.object({
			action: z.literal("wait"),
			ms: z.number().optional().describe("Sleep this long (max 30000)."),
			...zTarget,
			state: z
				.enum(["visible", "hidden", "attached", "detached"])
				.optional()
				.describe("For a ref, selector or text; default visible."),
			text: z.string().optional().describe("Wait for this text to appear."),
			url: z
				.string()
				.optional()
				.describe("Wait for the URL to match this glob."),
			script: z
				.string()
				.optional()
				.describe("Wait until this JS expression is truthy."),
			load: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
			timeout: z.number().optional().describe("Default 10000."),
		})
		.describe("Wait for time, or for exactly one condition."),
	z
		.object({
			action: z.literal("evaluate"),
			script: z
				.string()
				.describe(
					"A JS expression, a function, or a function body using `return`. With a target, the element is passed as `el`. Promises are awaited; the result must be JSON-serializable.",
				),
			...zTarget,
		})
		.describe("Run JavaScript in the page."),
	z
		.object({
			action: z.literal("console"),
			level: z
				.enum(["all", "warning", "error"])
				.optional()
				.describe("Minimum level (default all)."),
			limit: z.number().optional().describe("Most recent N (default 50)."),
			clear: z.boolean().optional().describe("Empty the log after reading."),
		})
		.describe("Read the console messages and page errors of the tab."),
	z
		.object({
			action: z.literal("resize"),
			width: z
				.number()
				.optional()
				.describe("Viewport width in CSS pixels (200–4000)."),
			height: z
				.number()
				.optional()
				.describe("Viewport height in CSS pixels (200–4000)."),
			reset: z
				.boolean()
				.optional()
				.describe("Go back to the default size instead."),
		})
		.describe(
			"Resize the active tab's viewport, e.g. 390×844 to see a page as a phone would. The size stays with the tab for later calls until reset.",
		),
	z
		.object({
			action: z.literal("screenshot"),
			...zTarget,
			fullPage: z.boolean().optional(),
		})
		.describe("Capture the viewport, the full page, or an element."),
	z
		.object({
			action: z.literal("tabs"),
			select: z.number().optional().describe("Switch to the tab at index."),
			open: z.string().optional().describe("Open a new tab at this URL."),
			close: z.number().optional().describe("Close the tab at index."),
		})
		.describe("List tabs, or open, switch or close one."),
]);
export type zBrowserStep = z.infer<typeof zBrowserStep>;

export const zBrowserStepResult = z.object({
	action: z.string(),
	ok: z.boolean(),
	value: z.unknown().optional(),
	error: z.string().optional(),
});
export type zBrowserStepResult = z.infer<typeof zBrowserStepResult>;

export const zBrowserRunResult = z.object({
	url: z.string(),
	title: z.string(),
	steps: z.array(zBrowserStepResult),
	/** Steps never reached because one before them failed or was aborted. */
	skipped: z.number().optional(),
	/**
	 * Something about how the run went that is not a failure: that the
	 * browser ran headless because no window could be shown, say.
	 */
	notice: z.string().optional(),
	/** One per `screenshot` step, then the final one when asked for. */
	screenshots: z.array(z.object({ mime: z.string(), data: z.string() })),
});
export type zBrowserRunResult = z.infer<typeof zBrowserRunResult>;

export const zBrowserInstall = z.object({
	name: z.string(),
	path: z.string(),
	/** Downloaded by Playwright, or installed on the system. */
	source: z.enum(["playwright", "system"]),
	version: z.string().optional(),
});
export type zBrowserInstall = z.infer<typeof zBrowserInstall>;

/** What the host found to drive a browser with, and whether it is enough. */
export const zBrowserStatus = z.object({
	available: z.boolean(),
	error: z.string().optional(),
	node: z.object({ path: z.string(), version: z.string() }).optional(),
	playwright: z
		.object({ path: z.string(), name: z.string(), version: z.string() })
		.optional(),
	browsers: z.array(zBrowserInstall),
	/** The install a run will launch: the first of `browsers`. */
	browser: zBrowserInstall.optional(),
	/**
	 * Whether the browser window can be shown here. Where it cannot (no
	 * desktop, as over SSH or a broken WSLg), showing it is asked for in vain
	 * and the browser runs headless instead.
	 */
	display: z
		.object({ available: z.boolean(), error: z.string().optional() })
		.optional(),
});
export type zBrowserStatus = z.infer<typeof zBrowserStatus>;
