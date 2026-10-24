import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Element, InputSim, Rect, Screenshot } from "@crowecawcaw/xa11y";
import type { ClientComputer } from "#client/client.ts";

type Xa11y = typeof import("@crowecawcaw/xa11y");

/**
 * How many past screenshots keep their coordinate mapping, so a point read
 * off one of them can still be clicked.
 */
const FRAMES = 16;
const DEFAULT_MAX_EDGE = 1280;

class Failure extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

interface Window {
	id: number;
	key: string;
	app: string;
	element: Element;
}

type Params = Record<string, any>;

/** xa11y's errors by the codes `ComputerService` acts on. */
const codeOf = (x: Xa11y, error: unknown) => {
	if (error instanceof Failure) return error.code;
	if (error instanceof x.PermissionDeniedError) return "permission";
	if (error instanceof x.AccessibilityNotEnabledError) {
		return "accessibility_disabled";
	}
	// Also what a stale element is reported as.
	if (error instanceof x.SelectorNotMatchedError) return "stale";
	if (error instanceof x.ActionNotSupportedError) return "unsupported";
	if (error instanceof x.TimeoutError) return "timeout";
	if (
		error instanceof x.InvalidActionDataError ||
		error instanceof x.InvalidSelectorError
	) {
		return "invalid";
	}
	return "platform";
};

const num = (params: Params, name: string) => {
	const value = params[name];
	if (typeof value !== "number")
		throw new Failure("invalid", `Missing ${name}`);
	return Math.round(value);
};

const str = (params: Params, name: string) => {
	const value = params[name];
	if (typeof value !== "string")
		throw new Failure("invalid", `Missing ${name}`);
	return value;
};

/** Canonical key names (`ComputerUtils.parseKeys`) as xa11y spells them. */
const KEYS: Record<string, string> = {
	shift: "Shift",
	ctrl: "Ctrl",
	alt: "Alt",
	meta: "Meta",
	enter: "Enter",
	escape: "Escape",
	backspace: "Backspace",
	tab: "Tab",
	space: "Space",
	delete: "Delete",
	insert: "Insert",
	up: "ArrowUp",
	down: "ArrowDown",
	left: "ArrowLeft",
	right: "ArrowRight",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
};

const key = (name: string) => {
	if (KEYS[name]) return KEYS[name];
	if ([...name].length === 1) return name;
	const f = /^f(\d+)$/.exec(name)?.[1];
	if (f && Number(f) >= 1 && Number(f) <= 24) return `F${f}`;
	throw new Failure("invalid", `Unknown key: ${name}`);
};

const rect = (rect: Rect | null) =>
	rect && {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
	};

const node = (element: Element, handle: number, parent: number | null) => {
	const states: string[] = [];
	const flag = (on: boolean, name: string) => on && states.push(name);
	flag(!element.enabled, "disabled");
	flag(!element.visible, "hidden");
	flag(element.focused, "focused");
	flag(element.active, "active");
	flag(element.selected, "selected");
	flag(element.editable, "editable");
	flag(element.modal, "modal");
	flag(element.required, "required");
	flag(element.busy, "busy");
	flag(element.minimized === true, "minimized");
	flag(element.expanded === true, "expanded");
	flag(element.expanded === false, "collapsed");
	flag(element.checked === "on", "checked");
	flag(element.checked === "off", "unchecked");
	flag(element.checked === "mixed", "mixed");

	const text = (value: string | null) => value || undefined;
	const bounds = rect(element.bounds);
	return {
		handle,
		parent,
		role: element.role,
		name: text(element.name),
		value: text(element.value),
		description: text(element.description),
		stableId: text(element.stableId),
		...(bounds ? { bounds } : {}),
		...(element.actions.length ? { actions: element.actions } : {}),
		...(states.length ? { states } : {}),
	};
};

/** Whether `name` is an installed `.desktop` entry, which `gtk-launch` opens. */
const isDesktopEntry = (name: string) => {
	const file = `${name.replace(/\.desktop$/, "")}.desktop`;
	const data = (
		process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share"
	).split(":");
	return [join(homedir(), ".local/share"), ...data].some((dir) =>
		existsSync(join(dir, "applications", file)),
	);
};

const which = (program: string) =>
	(process.env.PATH ?? "")
		.split(delimiter)
		.some((dir) => existsSync(join(dir, program)));

const isExecutable = (path: string) => {
	try {
		const stat = statSync(path);
		return stat.isFile() && (stat.mode & 0o111) !== 0;
	} catch {
		return false;
	}
};

/**
 * Opens an app by name, or a file or app by path, with the platform's own
 * launcher, without waiting for it.
 */
const launch = (params: Params) => {
	const target = str(params, "target");
	const args: string[] = (params.args ?? []).filter(
		(arg: unknown) => typeof arg === "string",
	);
	const isPath = existsSync(target);

	let command: string[];
	if (process.platform === "darwin") {
		command = ["open", ...(isPath ? [] : ["-a"]), target];
		if (args.length) command.push("--args", ...args);
	} else if (process.platform === "win32") {
		command = ["cmd", "/C", "start", "", target, ...args];
	} else if (isPath && !isExecutable(target)) {
		command = ["xdg-open", target];
	} else if (
		!isPath &&
		!args.length &&
		which("gtk-launch") &&
		isDesktopEntry(target)
	) {
		command = ["gtk-launch", target];
	} else {
		command = [target, ...args];
	}

	return new Promise<null>((resolve, reject) => {
		const [program = target, ...rest] = command;
		const child = spawn(program, rest, { stdio: "ignore", detached: true });
		child.once("error", (error) =>
			reject(new Failure("not_found", `Could not open ${target}: ${error}`)),
		);
		child.once("spawn", () => {
			child.unref();
			resolve(null);
		});
	});
};

/**
 * The `computer` tool's primitives over xa11y, for runtimes with Node's APIs
 * (the CLI, the desktop app's main process): reading windows and
 * accessibility trees, acting on elements, synthesising input, and capturing
 * the screen. Refs, formatting, waiting and policy live in core's
 * `ComputerService`; every call answers `{ ok, result }` or
 * `{ ok, error: { code, message } }`.
 */
const create = (x: Xa11y): ClientComputer => {
	let windows: Window[] = [];
	/** Window ids by identity, so a window keeps its id across listings. */
	const windowIds = new Map<string, number>();
	let nextWindow = 0;
	const handles = new Map<number, { window: number; element: Element }>();
	let nextHandle = 0;
	const frames: [number, Screenshot][] = [];
	let nextFrame = 0;
	let input: { sim: InputSim } | { error: string } | undefined;

	const inputSim = () => {
		if (!input) {
			try {
				input = { sim: x.inputSim() };
			} catch (error) {
				input = { error: String((error as Error)?.message ?? error) };
			}
		}
		if ("error" in input) throw new Failure("unsupported", input.error);
		return input.sim;
	};

	const status = async () => {
		const missing: string[] = [];
		const errors: Record<string, string> = {};
		try {
			await x.App.list();
		} catch (error) {
			if (error instanceof x.PermissionDeniedError)
				missing.push("accessibility");
			errors.accessibility = String((error as Error).message);
		}
		try {
			await x.screenshot({ region: { x: 0, y: 0, width: 1, height: 1 } });
		} catch (error) {
			if (error instanceof x.PermissionDeniedError) missing.push("screen");
			errors.screen = String((error as Error).message);
		}
		let hasInput = true;
		try {
			inputSim();
		} catch (error) {
			errors.input = (error as Error).message;
			hasInput = false;
		}
		return {
			os:
				process.platform === "darwin"
					? "macos"
					: process.platform === "win32"
						? "windows"
						: process.platform,
			pid: process.pid,
			input: hasInput,
			missing,
			errors,
		};
	};

	const refreshWindows = async () => {
		const next: Window[] = [];
		for (const app of await x.App.list()) {
			// An app that will not list its windows has none to offer.
			let elements: Element[];
			try {
				elements = await app.windows();
			} catch {
				continue;
			}
			for (const [index, element] of elements.entries()) {
				const identity = element.stableId ?? `${element.name ?? ""}#${index}`;
				const key = `${app.pid ?? 0}:${identity}`;
				let id = windowIds.get(key);
				if (id === undefined) {
					id = ++nextWindow;
					windowIds.set(key, id);
				}
				next.push({ id, key, app: app.name, element });
			}
		}
		for (const key of windowIds.keys()) {
			if (!next.some((window) => window.key === key)) windowIds.delete(key);
		}
		windows = next;
	};

	/**
	 * The window's element, from a fresh listing: a window read earlier may
	 * have moved, retitled, or closed since.
	 */
	const windowElement = async (id: number) => {
		await refreshWindows();
		const window = windows.find((window) => window.id === id);
		if (!window) {
			throw new Failure("not_found", `No window w${id}; list windows again`);
		}
		return window.element;
	};

	const handle = (id: number) => {
		const found = handles.get(id);
		if (!found) {
			throw new Failure("stale", `No element ${id}; read the window again`);
		}
		return found.element;
	};

	/** The screenshot named by `params.frame`, whose pixels points are in. */
	const frameOf = (params: Params) => {
		if (typeof params.frame !== "number") return undefined;
		const shot = frames.find(([frame]) => frame === params.frame)?.[1];
		if (!shot) {
			throw new Failure("stale", "That screenshot is too old; take a new one");
		}
		return shot;
	};

	const methods: Record<string, (params: Params) => Promise<unknown>> = {
		status,

		windows: async () => {
			await refreshWindows();
			return windows.map(({ id, app, element }) => ({
				id,
				pid: element.pid,
				app,
				title: element.name,
				bounds: rect(element.bounds),
				focused: element.active,
				minimized: element.minimized,
			}));
		},

		tree: async (params) => {
			const window = num(params, "window");
			const maxDepth = params.depth ?? 40;
			const maxNodes = params.maxNodes ?? 2000;

			let root: Element;
			if (typeof params.root === "number") {
				root = handle(params.root);
			} else {
				root = await windowElement(window);
				// A fresh read of the whole window replaces its handles.
				for (const [id, found] of handles) {
					if (found.window === window) handles.delete(id);
				}
			}

			const nodes: ReturnType<typeof node>[] = [];
			let truncated = false;
			const queue: [Element, number | null, number][] = [[root, null, 0]];
			for (let item = queue.shift(); item; item = queue.shift()) {
				const [element, parent, depth] = item;
				if (nodes.length >= maxNodes) {
					truncated = true;
					break;
				}
				const id = ++nextHandle;
				nodes.push(node(element, id, parent));
				// A subtree that fails to list is left out rather than failing
				// the whole read.
				const children = await element.children().catch(() => []);
				if (depth < maxDepth) {
					for (const child of children) queue.push([child, id, depth + 1]);
				} else if (children.length) {
					truncated = true;
				}
				handles.set(id, { window, element });
			}
			return { nodes, truncated };
		},

		act: async (params) => {
			const element = handle(num(params, "handle"));
			const action = str(params, "action");
			const value = () => {
				if (typeof params.value !== "string") {
					throw new Failure("invalid", `${action} needs a value`);
				}
				return params.value;
			};
			switch (action) {
				case "press":
					await element.press();
					break;
				case "focus":
					await element.focus();
					break;
				case "blur":
					await element.blur();
					break;
				case "toggle":
					await element.toggle();
					break;
				case "select":
					await element.select();
					break;
				case "expand":
					await element.expand();
					break;
				case "collapse":
					await element.collapse();
					break;
				case "show_menu":
					await element.showMenu();
					break;
				case "increment":
					await element.increment();
					break;
				case "decrement":
					await element.decrement();
					break;
				case "scroll_into_view":
					await element.scrollIntoView();
					break;
				case "set_value":
					await element.setValue(value());
					break;
				case "type_text":
					await element.typeText(value());
					break;
				default:
					await element.performAction(action);
			}
			return null;
		},

		input: async (params) => {
			const frame = frameOf(params);
			const point = (event: Params, x: string, y: string): number[] => {
				const point = [num(event, x), num(event, y)] as const;
				return frame ? frame.imageToDesktop(...point) : [...point];
			};
			if (!Array.isArray(params.events)) {
				throw new Failure("invalid", "input needs events");
			}
			const sim = inputSim();
			for (const event of params.events as Params[]) {
				const held = ((event.modifiers ?? []) as string[]).map(key);
				const button = event.button ?? "left";
				switch (str(event, "type")) {
					case "move":
						await sim.moveTo(point(event, "x", "y"));
						break;
					case "click":
						await sim.click(point(event, "x", "y"), {
							button,
							count: event.count ?? 1,
							held,
						});
						break;
					case "drag":
						await sim.drag(point(event, "x", "y"), point(event, "toX", "toY"), {
							button,
							held,
						});
						break;
					case "scroll":
						await sim.scroll(
							point(event, "x", "y"),
							Math.round(event.dx ?? 0),
							Math.round(event.dy ?? 0),
						);
						break;
					case "key":
						await sim.chord(key(str(event, "key")), held);
						break;
					case "text":
						await sim.typeText(str(event, "text"));
						break;
					default:
						throw new Failure("invalid", `Unknown input: ${event.type}`);
				}
			}
			return null;
		},

		capture: async (params) => {
			let region: Rect | undefined;
			if (params.region) {
				const { x: rx, y: ry } = {
					x: num(params.region, "x"),
					y: num(params.region, "y"),
				};
				const width = Math.max(num(params.region, "width"), 1);
				const height = Math.max(num(params.region, "height"), 1);
				// A region of an earlier screenshot is in its pixels; map both
				// corners back to the desktop.
				const frame = frameOf(params);
				const [sx, sy] = frame ? frame.imageToDesktop(rx, ry) : [rx, ry];
				const [ex, ey] = frame
					? frame.imageToDesktop(rx + width, ry + height)
					: [rx + width, ry + height];
				region = {
					x: sx ?? rx,
					y: sy ?? ry,
					width: Math.max((ex ?? 0) - (sx ?? 0), 1),
					height: Math.max((ey ?? 0) - (sy ?? 0), 1),
				};
			} else if (typeof params.handle === "number") {
				const bounds = handle(params.handle).bounds;
				if (!bounds)
					throw new Failure("no_bounds", "The element has no bounds");
				region = bounds;
			} else if (typeof params.window === "number") {
				const bounds = (await windowElement(params.window)).bounds;
				if (!bounds) throw new Failure("no_bounds", "The window has no bounds");
				region = bounds;
			}
			const maxEdge = Math.max(params.maxEdge ?? DEFAULT_MAX_EDGE, 1);

			let shot = await x.screenshot(region ? { region } : undefined);
			const edge = Math.max(shot.width, shot.height);
			if (edge > maxEdge) {
				const scale = maxEdge / edge;
				shot = shot.resize(
					Math.max(Math.round(shot.width * scale), 1),
					Math.max(Math.round(shot.height * scale), 1),
				);
			}

			const frame = ++nextFrame;
			frames.push([frame, shot]);
			while (frames.length > FRAMES) frames.shift();

			return {
				frame,
				mime: "image/png",
				data: shot.toPng().toString("base64"),
				width: shot.width,
				height: shot.height,
			};
		},

		window: async (params) => {
			const element = await windowElement(num(params, "window"));
			const op = str(params, "op");
			switch (op) {
				case "activate":
					await element.activate();
					break;
				case "minimize":
					await element.minimize();
					break;
				case "maximize":
					await element.maximize();
					break;
				case "restore":
					await element.restore();
					break;
				case "close":
					await element.close();
					break;
				case "move":
					await element.moveTo(num(params, "x"), num(params, "y"));
					break;
				case "resize":
					await element.resizeTo(num(params, "width"), num(params, "height"));
					break;
				default:
					throw new Failure("invalid", `Unknown window op: ${op}`);
			}
			return null;
		},

		launch,
	};

	// xa11y's live elements belong to the reads that made them, so calls run
	// one at a time, in order.
	let queue: Promise<unknown> = Promise.resolve();

	return {
		call: ({ method, params, abort }) => {
			const run = async () => {
				if (abort?.aborted) {
					return {
						ok: false,
						error: { code: "aborted", message: "The request was aborted" },
					};
				}
				try {
					const fn = methods[method];
					if (!fn) throw new Failure("invalid", `Unknown method: ${method}`);
					return { ok: true, result: await fn((params ?? {}) as Params) };
				} catch (error) {
					return {
						ok: false,
						error: {
							code: codeOf(x, error),
							message: error instanceof Error ? error.message : String(error),
						},
					};
				}
			};
			const result = queue.then(run, run);
			queue = result;
			return result;
		},
	};
};

let host: Promise<ClientComputer> | undefined;

export const ComputerHostService = {
	/**
	 * xa11y, loaded on first use since the toolset may never be. Where its
	 * native module cannot load, every call answers with why.
	 */
	create: (): ClientComputer => ({
		call: async (request) => {
			host ??= import("@crowecawcaw/xa11y").then(create);
			let computer: ClientComputer;
			try {
				computer = await host;
			} catch (error) {
				host = undefined;
				return {
					ok: false,
					error: {
						code: "platform",
						message: `xa11y failed to load: ${error instanceof Error ? error.message : String(error)}`,
					},
				};
			}
			return computer.call(request);
		},
	}),
} as const;
