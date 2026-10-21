import { z } from "zod";
import type { ComputerCapability } from "#core/core/types/capability.ts";
import {
	type ComputerInputEvent,
	zComputerCapture,
	zComputerLibraryStatus,
	type zComputerNode,
	type zComputerRect,
	zComputerResponse,
	type zComputerRunResult,
	type zComputerStatus,
	type zComputerStep,
	type zComputerStepResult,
	zComputerTree,
	zComputerWindow,
} from "#core/features/tool/types/computer.ts";
import { ComputerUtils } from "#core/features/tool/utils/ComputerUtils.ts";

/** A failure the host library reported, by its code (`stale`, `unsupported`, …). */
export class ComputerError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

interface Ref {
	window: number;
	handle: number;
	node: zComputerNode;
	path: string;
}

interface State {
	status?: zComputerLibraryStatus;
	target?: zComputerWindow;
	refs: Map<string, Ref>;
	next: number;
	/** The latest screenshot, whose pixels `x`/`y` are in. */
	frame?: number;
	/** Whether that screenshot was of the whole screen rather than a window. */
	frameIsScreen?: boolean;
}

type Screenshot = zComputerRunResult["screenshots"][number];

/** Long enough for an app to repaint and its tree to catch up. */
const SETTLE_MS = 150;
/** For calls that answer with nothing worth reading. */
const zNothing = z.unknown();
const MAX_NODES = 4000;
const MAX_EDGE = 1280;

/** State outlives a call, like the windows it describes. */
const states = new WeakMap<ComputerCapability, State>();

const stateOf = (capability: ComputerCapability) => {
	let state = states.get(capability);
	if (!state) {
		state = { refs: new Map(), next: 0 };
		states.set(capability, state);
	}
	return state;
};

const sleep = (ms: number, abort?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (abort?.aborted) return reject(abort.reason);
		const timer = setTimeout(() => {
			abort?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(abort?.reason);
		};
		abort?.addEventListener("abort", onAbort, { once: true });
	});

const call = async <T extends z.ZodType>(
	capability: ComputerCapability,
	method: string,
	params: unknown,
	schema: T,
	abort?: AbortSignal,
): Promise<z.infer<T>> => {
	const response = zComputerResponse.parse(
		await capability.call({ method, params, abort }),
	);
	if (!response.ok) {
		throw new ComputerError(response.error.code, response.error.message);
	}
	return schema.parse(response.result);
};

const label = (window: zComputerWindow) => ({
	id: `w${window.id}`,
	app: window.app,
	title: window.title ?? undefined,
});

/** What a missing permission means, and where to grant it. */
const describeMissing = (status: zComputerLibraryStatus) => {
	if (status.missing.includes("accessibility")) {
		return status.os === "macos"
			? "Accessibility access is off: allow Tiny Chat (or the terminal running the CLI) in System Settings › Privacy & Security › Accessibility, then recheck."
			: `Accessibility is unavailable: ${status.errors.accessibility ?? "unknown error"}`;
	}
	if (status.errors.accessibility) {
		return `Accessibility is unavailable: ${status.errors.accessibility}`;
	}
	return undefined;
};

const describeScreen = (status: zComputerLibraryStatus) =>
	status.os === "macos"
		? "Screen recording is off: allow Tiny Chat (or the terminal running the CLI) in System Settings › Privacy & Security › Screen & System Audio Recording, then recheck."
		: `Screenshots are unavailable: ${status.errors.screen ?? "unknown error"}`;

export const ComputerService = {
	/** Asks the host what it can do now, for the toolset and the settings UI. */
	status: async (capability: ComputerCapability): Promise<zComputerStatus> => {
		try {
			const status = await call(
				capability,
				"status",
				{},
				zComputerLibraryStatus,
			);
			stateOf(capability).status = status;
			const error = describeMissing(status);
			return {
				available: !error,
				error,
				os: status.os,
				input: status.input,
				missing: status.missing,
			};
		} catch (error) {
			return {
				available: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},

	/** Runs steps in order, stopping at the first that fails. */
	run: async ({
		capability,
		window,
		steps,
		screenshot,
		abort,
	}: {
		capability: ComputerCapability;
		window?: string;
		steps: zComputerStep[];
		screenshot?: boolean;
		abort?: AbortSignal;
	}): Promise<zComputerRunResult> => {
		const state = stateOf(capability);
		const run = createRun({ capability, state, abort });
		const results: zComputerStepResult[] = [];
		let skipped = 0;

		if (window) {
			try {
				state.target = await run.findWindow(window);
			} catch (error) {
				return {
					steps: [{ action: "window", ok: false, error: message(error) }],
					skipped: steps.length,
					screenshots: [],
				};
			}
		}

		for (const [index, step] of steps.entries()) {
			if (abort?.aborted) {
				skipped = steps.length - index;
				break;
			}
			try {
				const value = await run.step(step);
				results.push({
					action: step.action,
					ok: true,
					...(value === undefined ? {} : { value }),
				});
			} catch (error) {
				results.push({ action: step.action, ok: false, error: message(error) });
				skipped = steps.length - index - 1;
				break;
			}
		}

		// Steps retitle and close windows, so the result says how it is now.
		if (state.target && !abort?.aborted) {
			try {
				const id = state.target.id;
				state.target = (await run.windows()).find((w) => w.id === id);
			} catch {
				// The last known state still says which window was meant.
			}
		}

		if (screenshot && !abort?.aborted) {
			try {
				await run.capture(state.target ? { window: state.target.id } : {});
			} catch (error) {
				results.push({
					action: "screenshot",
					ok: false,
					error: message(error),
				});
			}
		}

		return {
			...(state.target ? { window: label(state.target) } : {}),
			steps: results,
			...(skipped ? { skipped } : {}),
			screenshots: run.screenshots,
		};
	},
} as const;

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** One call's worth of steps over the capability's lasting state. */
const createRun = ({
	capability,
	state,
	abort,
}: {
	capability: ComputerCapability;
	state: State;
	abort?: AbortSignal;
}) => {
	const screenshots: Screenshot[] = [];

	const request = <T extends z.ZodType>(
		method: string,
		params: unknown,
		schema: T,
	) => call(capability, method, params, schema, abort);

	const status = async () => {
		state.status ??= await request("status", {}, zComputerLibraryStatus);
		return state.status;
	};

	const os = async () => (await status()).os;

	/** Every window but Tiny Chat's own, which is not the agent's to drive. */
	const windows = async () => {
		const own = (await status()).pid;
		const all = await request("windows", {}, zComputerWindow.array());
		return all.filter((window) => window.pid !== own);
	};

	const findWindow = async (spec: string) => {
		const all = await windows();
		const id = /^w(\d+)$/i.exec(spec.trim())?.[1];
		if (id) {
			const window = all.find((window) => window.id === Number(id));
			if (!window) {
				throw new Error(`No window ${spec}; list them with a windows step`);
			}
			return window;
		}
		const needle = spec.toLowerCase();
		const matches = all.filter(
			(window) =>
				window.app.toLowerCase().includes(needle) ||
				window.title?.toLowerCase().includes(needle),
		);
		const window = matches.find((window) => window.focused) ?? matches[0];
		if (!window) {
			throw new Error(
				`No window matches "${spec}"; list them with a windows step, or open the app`,
			);
		}
		return window;
	};

	const target = () => {
		if (!state.target) {
			throw new Error(
				"No target window; name one with `window`, or use an open or windows step first",
			);
		}
		return state.target;
	};

	// ── Refs ──────────────────────────────────────────────────────────────

	/**
	 * Takes in a read of `window`, keeping each ref the user has seen on the
	 * element it named where that element can be found again (by stable id,
	 * else by where it sits), and returns the ref each interactive node gets.
	 */
	const bind = (
		window: number,
		nodes: zComputerNode[],
		root?: Ref,
	): ((node: zComputerNode) => string) => {
		const paths = ComputerUtils.paths(nodes, root?.path);
		const byId = new Map<string, zComputerNode>();
		const byPath = new Map<string, zComputerNode>();
		for (const node of nodes) {
			if (node.stableId) byId.set(node.stableId, node);
			byPath.set(paths.get(node.handle) ?? "", node);
		}

		const labels = new Map<number, string>();
		for (const [name, ref] of state.refs) {
			if (ref.window !== window) continue;
			const node =
				(ref.node.stableId && byId.get(ref.node.stableId)) ||
				byPath.get(ref.path);
			if (node) {
				state.refs.set(name, {
					window,
					handle: node.handle,
					node,
					path: paths.get(node.handle) ?? ref.path,
				});
				labels.set(node.handle, name);
			} else if (!root) {
				// A whole-window read replaced every handle in it.
				state.refs.delete(name);
			}
		}

		return (node) => {
			let name = labels.get(node.handle);
			if (!name) {
				name = `e${++state.next}`;
				labels.set(node.handle, name);
				state.refs.set(name, {
					window,
					handle: node.handle,
					node,
					path: paths.get(node.handle) ?? "",
				});
			}
			return name;
		};
	};

	const readTree = async (window: number, root?: Ref, depth?: number) =>
		request(
			"tree",
			{
				window,
				...(root ? { root: root.handle } : {}),
				depth: depth ?? 40,
				maxNodes: MAX_NODES,
			},
			zComputerTree,
		);

	/** Reads the window again so its refs point at live elements. */
	const refresh = async (window: number) => {
		const tree = await readTree(window);
		const refOf = bind(window, tree.nodes);
		for (const node of tree.nodes) {
			if (ComputerUtils.isInteractive(node)) refOf(node);
		}
		return tree;
	};

	const refOf = (name: string) => {
		const ref = state.refs.get(name.trim());
		if (!ref) throw new Error(`No element ${name}; read the window again`);
		return ref;
	};

	/**
	 * Runs `act` on a ref, and once more after reading the window again if its
	 * element went stale: apps rebuild their trees as they change.
	 */
	const withRef = async <T>(name: string, act: (ref: Ref) => Promise<T>) => {
		const ref = refOf(name);
		try {
			return await act(ref);
		} catch (error) {
			if (!(error instanceof ComputerError) || error.code !== "stale") {
				throw error;
			}
			await refresh(ref.window);
			const again = state.refs.get(name.trim());
			if (!again) {
				throw new Error(`${name} is gone; read the window again`);
			}
			return act(again);
		}
	};

	// ── Acting ────────────────────────────────────────────────────────────

	const act = async (ref: Ref, action: string, value?: string) => {
		await request(
			"act",
			{ handle: ref.handle, action, ...(value === undefined ? {} : { value }) },
			zNothing,
		);
		await sleep(SETTLE_MS, abort);
	};

	/**
	 * Brings the target window forward: input goes to whatever is in front,
	 * as it would for a person. Best effort, since not every window manager
	 * lets a window be raised.
	 */
	const raise = async () => {
		if (!state.target) return;
		const id = state.target.id;
		const window = (await windows()).find((window) => window.id === id);
		if (!window) {
			state.target = undefined;
			throw new Error("The target window has closed; list windows again");
		}
		state.target = window;
		if (window.focused) return;
		try {
			await request("window", { window: id, op: "activate" }, zNothing);
			await sleep(SETTLE_MS, abort);
		} catch (error) {
			if (!(error instanceof ComputerError)) throw error;
		}
	};

	const input = async (events: ComputerInputEvent[], frame?: number) => {
		const status_ = await status();
		if (!status_.input) {
			throw new Error(
				`Pointer and keyboard input are unavailable here (${status_.errors.input ?? "unsupported"}); act on refs instead`,
			);
		}
		// A point read off a screenshot of the whole screen may be meant for
		// any window, so only then is the target left where it is.
		if (frame === undefined || !state.frameIsScreen) await raise();
		await request(
			"input",
			{ events, ...(frame === undefined ? {} : { frame }) },
			zNothing,
		);
		await sleep(SETTLE_MS, abort);
	};

	const centerOf = (ref: Ref, name: string) => {
		if (!ref.node.bounds) throw new Error(`${name} has no position on screen`);
		return ComputerUtils.center(ref.node.bounds);
	};

	/** Where a step points: a ref's center in desktop points, or x/y in the latest screenshot. */
	const pointOf = async (
		step: { ref?: string; x?: number; y?: number },
		then: (point: { x: number; y: number }, frame?: number) => Promise<void>,
	) => {
		if (step.ref) {
			const name = step.ref;
			return withRef(name, (ref) => then(centerOf(ref, name)));
		}
		if (step.x === undefined || step.y === undefined) {
			throw new Error("Give a ref, or x and y");
		}
		if (state.frame === undefined) {
			throw new Error(
				"x/y are pixels in a screenshot; take one first, or use a ref",
			);
		}
		return then({ x: step.x, y: step.y }, state.frame);
	};

	const focus = async (ref: Ref, name: string) => {
		try {
			await act(ref, "focus");
		} catch (error) {
			if (!(error instanceof ComputerError) || error.code !== "unsupported") {
				throw error;
			}
			await input([{ type: "click", ...centerOf(ref, name) }]);
		}
	};

	const capture = async (params: {
		window?: number;
		handle?: number;
		region?: zComputerRect;
		frame?: number;
	}) => {
		let shot: zComputerCapture;
		try {
			shot = await request(
				"capture",
				{ ...params, maxEdge: MAX_EDGE },
				zComputerCapture,
			);
		} catch (error) {
			if (error instanceof ComputerError && error.code === "permission") {
				throw new Error(describeScreen(await status()));
			}
			throw error;
		}
		state.frame = shot.frame;
		// A zoomed region is part of whatever its screenshot was of.
		if (!params.region) {
			state.frameIsScreen =
				params.window === undefined && params.handle === undefined;
		}
		screenshots.push({ mime: shot.mime, data: shot.data });
		return `screenshot ${screenshots.length} attached (${shot.width}×${shot.height}); x/y now refer to it`;
	};

	// ── Steps ─────────────────────────────────────────────────────────────

	const step = async (step: zComputerStep): Promise<unknown> => {
		switch (step.action) {
			case "windows": {
				const all = await windows();
				return all.map((window) => ({
					...label(window),
					...(window.focused ? { focused: true } : {}),
					...(window.minimized ? { minimized: true } : {}),
					...(window.id === state.target?.id ? { target: true } : {}),
				}));
			}

			case "open": {
				const before = await windows();
				const needle = step.app.toLowerCase();
				const named = (window: zComputerWindow) =>
					window.app.toLowerCase().includes(needle) ||
					!!window.title?.toLowerCase().includes(needle);

				const open = before.find(named);
				if (open && !step.args?.length) {
					await request(
						"window",
						{ window: open.id, op: "activate" },
						zNothing,
					);
					state.target = open;
					return { ...label(open), already: true };
				}

				await request(
					"launch",
					{ target: step.app, args: step.args ?? [] },
					zNothing,
				);
				const known = new Set(before.map((window) => window.id));
				const timeout = Math.min(step.timeout ?? 15_000, 60_000);
				const start = Date.now();
				while (Date.now() - start < timeout) {
					await sleep(300, abort);
					const fresh = (await windows()).filter((w) => !known.has(w.id));
					// An app's name need not match what it was opened by; after a
					// moment, any window that appeared is taken to be it.
					const window =
						fresh.find(named) ??
						(Date.now() - start > 3_000 ? fresh[0] : undefined);
					if (window) {
						state.target = window;
						return label(window);
					}
				}
				throw new Error(
					`Opened ${step.app}, but no window appeared within ${timeout}ms`,
				);
			}

			case "read": {
				const window = target();
				if (step.ref) {
					const name = step.ref;
					return withRef(name, async (root) => {
						const tree = await readTree(window.id, root, step.depth);
						return render(tree, bind(window.id, tree.nodes, root), step);
					});
				}
				const tree = await readTree(window.id, undefined, step.depth);
				return render(tree, bind(window.id, tree.nodes), step);
			}

			case "click": {
				const plain =
					(step.button ?? "left") === "left" &&
					(step.count ?? 1) === 1 &&
					!step.modifiers?.length;
				if (step.ref && plain) {
					const name = step.ref;
					return withRef(name, async (ref) => {
						if (ref.node.actions?.includes("press")) {
							await act(ref, "press");
							return "pressed";
						}
						await input([{ type: "click", ...centerOf(ref, name) }]);
						return "clicked";
					});
				}
				const modifiers = ComputerUtils.modifiers(step.modifiers, await os());
				await pointOf(step, (point, frame) =>
					input(
						[
							{
								type: "click",
								...point,
								button: step.button,
								count: step.count,
								modifiers,
							},
						],
						frame,
					),
				);
				return "clicked";
			}

			case "type": {
				if (step.ref) {
					const name = step.ref;
					await withRef(name, async (ref) => {
						// Focused first, so the keys that follow (`submit`, or the
						// next step's) land in the field.
						await focus(ref, name);
						if (step.clear ?? true) {
							try {
								await act(ref, "set_value", step.text);
								return;
							} catch (error) {
								if (
									!(error instanceof ComputerError) ||
									!["unsupported", "invalid"].includes(error.code)
								) {
									throw error;
								}
							}
							const [selectAll] = ComputerUtils.parseKeys("Mod+a", await os());
							await input([
								{ type: "key", ...selectAll },
								{ type: "text", text: step.text },
							]);
							return;
						}
						await input([{ type: "text", text: step.text }]);
					});
				} else {
					await input([{ type: "text", text: step.text }]);
				}
				if (step.submit) await input([{ type: "key", key: "enter" }]);
				return undefined;
			}

			case "press": {
				const chords = ComputerUtils.parseKeys(step.keys, await os());
				await input(
					chords.map((chord) => ({ type: "key" as const, ...chord })),
				);
				return undefined;
			}

			case "scroll": {
				if (step.ref && step.dx === undefined && step.dy === undefined) {
					await withRef(step.ref, (ref) => act(ref, "scroll_into_view"));
					return "scrolled into view";
				}
				await pointOf(step, (point, frame) =>
					input(
						[
							{
								type: "scroll",
								...point,
								dx: step.dx ?? 0,
								dy: step.dy ?? 5,
							},
						],
						frame,
					),
				);
				return undefined;
			}

			case "drag": {
				const toRef = step.toRef;
				if (step.ref ? !toRef : !!toRef) {
					throw new Error(
						"Drag between two refs, or between two points of the latest screenshot",
					);
				}
				if (step.ref && toRef) {
					const from = centerOf(refOf(step.ref), step.ref);
					const to = centerOf(refOf(toRef), toRef);
					await input([
						{ type: "drag", x: from.x, y: from.y, toX: to.x, toY: to.y },
					]);
					return undefined;
				}
				if (step.toX === undefined || step.toY === undefined) {
					throw new Error("Give toX and toY, or toRef");
				}
				const { toX, toY } = step;
				await pointOf(step, (point, frame) =>
					input([{ type: "drag", ...point, toX, toY }], frame),
				);
				return undefined;
			}

			case "wait": {
				if (!step.find) {
					await sleep(Math.min(step.ms ?? 1_000, 30_000), abort);
					return undefined;
				}
				const window = target();
				const timeout = Math.min(step.timeout ?? 10_000, 60_000);
				const start = Date.now();
				let delay = 200;
				for (;;) {
					const tree = await refresh(window.id);
					const found = ComputerUtils.findAll(tree.nodes, step.find);
					if (step.gone ? !found.length : found.length) {
						return step.gone ? "gone" : `found ${found.length}`;
					}
					if (Date.now() - start >= timeout) {
						throw new Error(
							`${step.gone ? "Still" : "Never"} found "${step.find}" after ${timeout}ms`,
						);
					}
					await sleep(delay, abort);
					delay = Math.min(delay * 2, 1_000);
				}
			}

			case "screenshot": {
				if (step.ref) {
					return withRef(step.ref, (ref) => capture({ handle: ref.handle }));
				}
				if (step.region) {
					if (state.frame === undefined) {
						throw new Error(
							"A region is in a screenshot's pixels; take one first",
						);
					}
					return capture({ region: step.region, frame: state.frame });
				}
				if (step.screen || !state.target) return capture({});
				return capture({ window: state.target.id });
			}

			case "window": {
				const window = target();
				await request(
					"window",
					{
						window: window.id,
						op: step.op,
						...(step.x === undefined ? {} : { x: step.x }),
						...(step.y === undefined ? {} : { y: step.y }),
						...(step.width === undefined ? {} : { width: step.width }),
						...(step.height === undefined ? {} : { height: step.height }),
					},
					zNothing,
				);
				if (step.op === "close") state.target = undefined;
				await sleep(SETTLE_MS, abort);
				return undefined;
			}
		}
	};

	const render = (
		tree: zComputerTree,
		refOf: (node: zComputerNode) => string,
		step: Extract<zComputerStep, { action: "read" }>,
	) => {
		const outline = ComputerUtils.outline({
			nodes: tree.nodes,
			refOf,
			find: step.find,
			maxLength: step.maxLength,
		});
		return tree.truncated
			? `${outline}\n… the window has more than was read; read a narrower ref or use find`
			: outline;
	};

	return { step, findWindow, windows, capture, screenshots };
};
