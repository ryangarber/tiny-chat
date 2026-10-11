import { type DOMElement, measureElement } from "ink";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

/** A position in terminal cells, measured from the top left of the screen. */
export type MousePoint = {
	x: number;
	y: number;
};

/** A rectangle in terminal cells, measured from the top left of the screen. */
export type MouseBounds = MousePoint & {
	width: number;
	height: number;
};

type MouseButton = "left" | "middle" | "right" | "none";

export type MouseEvent = MousePoint & {
	type: "down" | "up" | "move" | "wheel";
	button: MouseButton;
	/** Wheel steps, negative up and positive down. Zero for every other event. */
	deltaY: number;
	/** Wheel steps, negative left and positive right. Zero for every other event. */
	deltaX: number;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
};

/**
 * SGR mouse report: `ESC [ < button ; column ; row M` for a press (`m` for a
 * release), with coordinates counted from 1.
 */
const SGR_REGEX =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal hell
	/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Low two bits of the button code, once the modifier and mode bits are masked off. */
const BUTTONS: MouseButton[] = ["left", "middle", "right", "none"];

const SHIFT = 4;
const ALT = 8;
const CTRL = 16;
/** The pointer moved rather than a button changing state. */
const MOTION = 32;
/** The wheel turned, with the button bits carrying the direction. */
const WHEEL = 64;

type DOMNode = DOMElement["childNodes"][number];

/** The text a node shows, before Ink styles it. */
const textOf = (node: DOMNode): string =>
	node.nodeName === "#text"
		? node.nodeValue
		: node.childNodes.map(textOf).join("");

/** The text that comes before `target` inside `node`, or null if it is not there. */
const textBefore = (node: DOMElement, target: DOMElement): string | null => {
	let text = "";
	for (const child of node.childNodes) {
		if (child === target) return text;
		if (child.nodeName !== "#text") {
			const before = textBefore(child, target);
			if (before !== null) return text + before;
		}
		text += textOf(child);
	}
	return null;
};

/**
 * Where the character at `index` of `text` lands once Ink has wrapped it into
 * `wrapped`. Wrapping only adds line breaks, and at most drops the spaces it
 * breaks on, so the two are walked side by side.
 */
const locate = (text: string, wrapped: string, index: number) => {
	let line = 0;
	let lineStart = 0;
	let j = 0;
	for (let i = 0; i < index && j < wrapped.length; ) {
		if (text[i] === wrapped[j]) {
			if (wrapped[j] === "\n") {
				line++;
				lineStart = j + 1;
			}
			i++;
			j++;
		} else if (wrapped[j] === "\n") {
			j++;
			line++;
			lineStart = j;
		} else if (text[i] === " ") {
			i++;
		} else {
			return null;
		}
	}
	// The character itself may be the first on the next line.
	if (wrapped[j] === "\n") {
		j++;
		line++;
		lineStart = j;
	}
	return { line, column: stringWidth(wrapped.slice(lineStart, j)) };
};

/** Overlays drawn over the rest, each taking the mouse wherever it is drawn. */
const layers: DOMElement[] = [];

/** Child indices from the root down to `node`. */
const path = (node: DOMElement) => {
	const indices: number[] = [];
	for (let child = node; child.parentNode; child = child.parentNode)
		indices.unshift(child.parentNode.childNodes.indexOf(child));
	return indices;
};

/** Orders nodes as Ink draws them: a later sibling over an earlier one, and a child over its parent. */
const byDrawOrder = (a: DOMElement, b: DOMElement) => {
	const [pathA, pathB] = [path(a), path(b)];
	for (let i = 0; i < Math.min(pathA.length, pathB.length); i++)
		if (pathA[i] !== pathB[i]) return pathA[i] - pathB[i];
	return pathA.length - pathB.length;
};

const isInside = (node: DOMElement, ancestor: DOMElement) => {
	for (
		let parent: DOMElement | undefined = node;
		parent;
		parent = parent.parentNode
	)
		if (parent === ancestor) return true;
	return false;
};

export const MouseUtils = {
	/**
	 * Pulls every mouse report out of a chunk of terminal input, ignoring
	 * anything else it is bundled with.
	 */
	parse: (data: string): MouseEvent[] => {
		const events: MouseEvent[] = [];

		for (const match of data.matchAll(SGR_REGEX)) {
			const code = Number.parseInt(match[1], 10);
			const direction = code & 3;
			const isWheel = (code & WHEEL) !== 0;

			events.push({
				type: isWheel
					? "wheel"
					: (code & MOTION) !== 0
						? "move"
						: match[4] === "m"
							? "up"
							: "down",
				button: isWheel ? "none" : BUTTONS[direction],
				deltaY: isWheel && direction < 2 ? (direction === 0 ? -1 : 1) : 0,
				deltaX: isWheel && direction >= 2 ? (direction === 2 ? -1 : 1) : 0,
				x: Number.parseInt(match[2], 10) - 1,
				y: Number.parseInt(match[3], 10) - 1,
				shift: (code & SHIFT) !== 0,
				alt: (code & ALT) !== 0,
				ctrl: (code & CTRL) !== 0,
			});
		}

		return events;
	},

	/**
	 * Removes every mouse report from a chunk of terminal input, leaving the
	 * keystrokes it was bundled with behind.
	 */
	strip: (data: string): string => data.replace(SGR_REGEX, ""),

	/**
	 * Where an element sits on screen, in the same coordinates mouse reports use.
	 *
	 * {@link measureElement} positions a node inside Ink's live region, which is
	 * anchored to the bottom of the terminal, so the region's own top row is
	 * however far it falls short of filling the screen.
	 */
	bounds: (node: DOMElement, rows: number): MouseBounds => {
		const { x, y, width, height } = measureElement(node);

		let root = node;
		while (root.parentNode) root = root.parentNode;

		const top = rows - (root.yogaNode?.getComputedHeight() ?? rows);

		return { x, y: y + top, width, height };
	},

	/**
	 * Where an inline run of text (a `<Text>` nested in another) sits on screen,
	 * or null where it cannot be seen. Inline text has no layout of its own, so
	 * the block it sits in is wrapped the way Ink wraps it to find the run.
	 *
	 * Only the run's first character is placed, and it is assumed to fit on one
	 * line, which holds for the short labels this is meant for.
	 */
	textBounds: (node: DOMElement, rows: number): MouseBounds | null => {
		let block = node.parentNode;
		while (block && block.nodeName !== "ink-text") block = block.parentNode;
		if (!block?.yogaNode) return null;

		const textWrap = block.style.textWrap ?? "wrap";
		if (textWrap !== "wrap" && textWrap !== "hard") return null;

		const before = textBefore(block, node);
		if (before === null) return null;

		const own = textOf(node);
		const text = textOf(block);
		const bounds = MouseUtils.bounds(block, rows);

		// Ink only wraps text that does not fit, so neither does this.
		const fits = text
			.split("\n")
			.every((line) => stringWidth(line) <= bounds.width);
		const wrapped = fits
			? text
			: wrapAnsi(text, bounds.width, {
					trim: false,
					hard: true,
					wordWrap: textWrap === "wrap",
				});

		const position = locate(text, wrapped, before.length);
		if (!position) return null;

		const result = {
			x: bounds.x + position.column,
			y: bounds.y + position.line,
			width: stringWidth(own),
			height: 1,
		};

		// Rows scrolled out of a view are still laid out, just not drawn.
		for (let parent = block.parentNode; parent; parent = parent.parentNode) {
			const { overflow, overflowX, overflowY } = parent.style;
			if (
				overflow !== "hidden" &&
				overflowX !== "hidden" &&
				overflowY !== "hidden"
			) {
				continue;
			}
			const clip = MouseUtils.bounds(parent, rows);
			if (
				!MouseUtils.contains(clip, result) ||
				!MouseUtils.contains(clip, {
					x: result.x + result.width - 1,
					y: result.y,
				})
			) {
				return null;
			}
		}

		return result;
	},

	contains: (bounds: MouseBounds, point: MousePoint) =>
		point.x >= bounds.x &&
		point.x < bounds.x + bounds.width &&
		point.y >= bounds.y &&
		point.y < bounds.y + bounds.height,

	/**
	 * Draws `node` as an overlay: where it lies, only what is drawn inside it
	 * takes the mouse, until removed.
	 */
	addLayer: (node: DOMElement) => {
		layers.push(node);
		return () => {
			layers.splice(layers.indexOf(node), 1);
		};
	},

	/** Whether an overlay is drawn over `node` at `point`, hiding it from the mouse there. */
	isCovered: (node: DOMElement, point: MousePoint, rows: number) => {
		const top = layers
			.filter((layer) =>
				MouseUtils.contains(MouseUtils.bounds(layer, rows), point),
			)
			.sort(byDrawOrder)
			.at(-1);
		return !!top && !isInside(node, top);
	},
} as const;
