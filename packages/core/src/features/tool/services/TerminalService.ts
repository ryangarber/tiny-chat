import type { ShellCapability } from "#core/core/types/capability.ts";
import type {
	TerminalCell,
	TerminalMatch,
	zTerminalRunResult,
	zTerminalScreen,
	zTerminalSession,
	zTerminalStep,
	zTerminalStepResult,
} from "#core/features/tool/types/terminal.ts";
import { TerminalUtils } from "#core/features/tool/utils/TerminalUtils.ts";

/** Marks the sessions this tool opened, so they are known across restarts. */
const OPENED = "@tiny_chat";
const WIDTH = 120;
const HEIGHT = 40;
const POLL_MS = 100;
/** Long enough for a program to read its input and start drawing. */
const SETTLE_MS = 30;
const ESCAPE_MS = 150;

const INFO = [
	"#{session_name}",
	"#{pane_width}",
	"#{pane_height}",
	"#{cursor_x}",
	"#{cursor_y}",
	"#{cursor_flag}",
	"#{pane_dead}",
	"#{pane_dead_status}",
	"#{mouse_sgr_flag}",
	"#{mouse_standard_flag}",
	"#{mouse_button_flag}",
	"#{mouse_any_flag}",
].join("\t");

const SESSION = [
	"#{session_name}",
	"#{window_width}",
	"#{window_height}",
	"#{session_attached}",
	`#{${OPENED}}`,
	"#{pane_current_command}",
	"#{pane_dead}",
	"#{pane_dead_status}",
].join("\t");

interface Snapshot {
	session: string;
	width: number;
	height: number;
	cursor?: { row: number; col: number };
	exited?: number;
	mouse: { on: boolean; sgr: boolean; motion: boolean };
	rows: TerminalCell[][];
	/** The number of the first row: 1, or less with scrollback above it. */
	top: number;
	/**
	 * Its text, for telling whether anything changed: a cursor a program blinks
	 * by its own drawing would otherwise never let a screen settle.
	 */
	text: string;
}

/** A step that failed on what was on screen, which is worth showing. */
class ScreenError extends Error {
	readonly snapshot: Snapshot;

	constructor(message: string, snapshot: Snapshot) {
		super(message);
		this.snapshot = snapshot;
	}
}

interface State {
	/** The session steps act on. */
	target?: string;
}

/** State outlives a call, like the sessions it names. */
const states = new WeakMap<ShellCapability, State>();
const available = new WeakMap<ShellCapability, Promise<boolean>>();

const stateOf = (shell: ShellCapability) => {
	let state = states.get(shell);
	if (!state) {
		state = {};
		states.set(shell, state);
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

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** A session as a target: `=` so `tc-1` never means `tc-10`. */
const session = (name: string) => `=${name}`;
/** Its active pane. */
const pane = (name: string) => `=${name}:`;

const INPUT = new Set([
	"type",
	"press",
	"click",
	"drag",
	"scroll",
	"resize",
	"close",
]);

export const TerminalService = {
	/** Whether tmux runs in this shell. Asked once per shell. */
	available: (shell: ShellCapability): Promise<boolean> => {
		let result = available.get(shell);
		if (!result) {
			result = (async () => {
				if (!shell.run) return false;
				const { code } = await shell.run({ program: "tmux", args: ["-V"] });
				return code === 0;
			})().catch(() => false);
			available.set(shell, result);
		}
		return result;
	},

	/**
	 * Whether a call would act on a session it did not open — one of the
	 * user's own — with more than looking at it.
	 */
	touchesForeign: async ({
		shell,
		session: name,
		steps,
	}: {
		shell: ShellCapability;
		session?: string;
		steps: zTerminalStep[];
	}) => {
		const target = name ?? stateOf(shell).target;
		const before = steps.findIndex((step) => step.action === "open");
		const acts = steps
			.slice(0, before < 0 ? undefined : before)
			.some((step) => INPUT.has(step.action));
		if (!target || !acts) return false;
		const sessions = await createRun({ shell }).sessions();
		const found = sessions.find((s) => s.name === target);
		return !!found && !found.opened;
	},

	/** Runs steps in order, stopping at the first that fails. */
	run: async ({
		shell,
		session: name,
		steps,
		capture,
		abort,
	}: {
		shell: ShellCapability;
		session?: string;
		steps: zTerminalStep[];
		capture?: boolean;
		abort?: AbortSignal;
	}): Promise<zTerminalRunResult> => {
		const state = stateOf(shell);
		if (name) state.target = name;
		const run = createRun({ shell, abort });
		const results: zTerminalStepResult[] = [];
		const screens: zTerminalScreen[] = [];
		let skipped = 0;
		const started = Date.now();

		for (const [index, step] of steps.entries()) {
			if (abort?.aborted) {
				skipped = steps.length - index;
				break;
			}
			try {
				const value = await run.step(step, state, screens);
				results.push({
					action: step.action,
					ok: true,
					...(value === undefined ? {} : { value }),
				});
			} catch (error) {
				const screen =
					error instanceof ScreenError
						? run.screen(screens, error.snapshot, {
								at: Date.now() - started,
							})
						: undefined;
				results.push({
					action: step.action,
					ok: false,
					error: message(error),
					...(screen ? { value: { screen } } : {}),
				});
				skipped = steps.length - index - 1;
				break;
			}
		}

		if (capture && state.target && !abort?.aborted) {
			try {
				run.screen(screens, await run.snapshot(state.target));
			} catch (error) {
				results.push({ action: "capture", ok: false, error: message(error) });
			}
		}

		let current: zTerminalSession | undefined;
		if (state.target && !abort?.aborted) {
			const target = state.target;
			current = (await run.sessions().catch(() => [])).find(
				(s) => s.name === target,
			);
		}

		return {
			...(current ? { session: current } : {}),
			steps: results,
			...(skipped ? { skipped } : {}),
			screens,
		};
	},
} as const;

/** One call's worth of tmux over the shell. */
const createRun = ({
	shell,
	abort,
}: {
	shell: ShellCapability;
	abort?: AbortSignal;
}) => {
	const tmux = async (args: string[]) => {
		if (!shell.run) throw new Error("This shell cannot run tmux.");
		const result = await shell.run({ program: "tmux", args, abort });
		if (result.code) {
			throw new Error(
				result.stderr.trim() ||
					result.stdout.trim() ||
					`tmux exited with status ${result.code}`,
			);
		}
		return result.stdout;
	};

	const sessions = async (): Promise<zTerminalSession[]> => {
		let out: string;
		try {
			out = await tmux(["list-sessions", "-F", SESSION]);
		} catch (error) {
			if (
				/no server running|error connecting|no sessions/i.test(message(error))
			)
				return [];
			throw error;
		}
		return out
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [name, width, height, attached, opened, command, dead, status] =
					line.split("\t");
				return {
					name,
					width: Number(width),
					height: Number(height),
					...(command ? { command } : {}),
					...(dead === "1" ? { exited: Number(status) || 0 } : {}),
					...(Number(attached) ? { attached: true } : {}),
					...(opened === "1" ? { opened: true } : {}),
					attach: `tmux attach -t ${name}`,
				};
			});
	};

	const snapshot = async (name: string, history = 0): Promise<Snapshot> => {
		const out = await tmux([
			"display-message",
			"-p",
			"-t",
			pane(name),
			INFO,
			";",
			"capture-pane",
			"-p",
			"-e",
			"-N",
			"-t",
			pane(name),
			...(history ? ["-S", `-${history}`] : []),
		]);
		const newline = out.indexOf("\n");
		const [
			session,
			width,
			height,
			x,
			y,
			cursor,
			dead,
			status,
			sgr,
			standard,
			button,
			any,
		] = out.slice(0, newline).split("\t");
		const rows = TerminalUtils.parse(out.slice(newline + 1));
		const h = Number(height);
		// The screen is always its full height, so whatever is past it is scrollback.
		while (rows.length < h) rows.push([]);
		return {
			session,
			width: Number(width),
			height: h,
			...(cursor === "1"
				? { cursor: { row: Number(y) + 1, col: Number(x) + 1 } }
				: {}),
			...(dead === "1" ? { exited: Number(status) || 0 } : {}),
			mouse: {
				on: [standard, button, any].includes("1"),
				sgr: sgr === "1",
				motion: button === "1" || any === "1",
			},
			rows,
			top: 1 - (rows.length - h),
			text: rows.map(TerminalUtils.text).join("\n"),
		};
	};

	/** Adds a screen to the result, returning its number (from 1). */
	const screen = (
		screens: zTerminalScreen[],
		snap: Snapshot,
		{ top, bottom, at }: { top?: number; bottom?: number; at?: number } = {},
	) => {
		const first = Math.max(top ?? snap.top, snap.top);
		const rows = snap.rows.slice(
			first - snap.top,
			bottom === undefined ? undefined : bottom - snap.top + 1,
		);
		const lines = rows.map(TerminalUtils.text);
		while (lines.length && !lines.at(-1)) lines.pop();
		screens.push({
			session: snap.session,
			width: snap.width,
			height: snap.height,
			...(snap.cursor ? { cursor: snap.cursor } : {}),
			top: first,
			...(at === undefined ? {} : { at }),
			lines,
		});
		return screens.length;
	};

	const send = (name: string, bytes: number[]) =>
		tmux([
			"send-keys",
			"-t",
			pane(name),
			"-H",
			...bytes.map((b) => b.toString(16).padStart(2, "0")),
		]);

	/** A live snapshot of the target, for steps that give it input. */
	const live = async (name: string) => {
		const snap = await snapshot(name);
		if (snap.exited !== undefined)
			throw new ScreenError(
				`The program has exited (status ${snap.exited}). Open it again to restart it.`,
				snap,
			);
		return snap;
	};

	/** Where a match is on screen: the middle of the first one, or the cell it names. */
	const locate = (snap: Snapshot, match: TerminalMatch) => {
		if (!TerminalUtils.isMatch(match))
			throw new Error(
				"Say where: `text` or `regex` to find, or a `row` and `col`.",
			);
		const [found] = TerminalUtils.find(snap.rows, match, snap.top);
		if (!found)
			throw new ScreenError(
				`Nothing on screen matches ${TerminalUtils.describe(match)}.`,
				snap,
			);
		return {
			row: found.row,
			col: found.col + Math.floor((found.width - 1) / 2),
		};
	};

	const mouse = (snap: Snapshot) => {
		if (!snap.mouse.on)
			throw new ScreenError(
				"The program is not reading the mouse: it has not turned mouse reporting on.",
				snap,
			);
		return snap.mouse;
	};

	const nextName = async () => {
		const taken = new Set((await sessions()).map((s) => s.name));
		let n = 1;
		while (taken.has(`tc-${n}`)) n++;
		return `tc-${n}`;
	};

	const step = async (
		step: zTerminalStep,
		state: State,
		screens: zTerminalScreen[],
	): Promise<unknown> => {
		const started = Date.now();
		const elapsed = () => Date.now() - started;

		if (step.action === "sessions") return await sessions();

		if (step.action === "open") {
			const name = step.name ?? (await nextName());
			if (!/^[\w-]+$/.test(name))
				throw new Error("Session names are letters, digits, `-` and `_`.");
			const existing = (await sessions()).find((s) => s.name === name);
			if (existing && !existing.opened)
				throw new Error(
					`"${name}" is a session this tool did not open, so it is left alone. Pick another name.`,
				);
			if (existing) await tmux(["kill-session", "-t", session(name)]);

			const width = String(step.width ?? WIDTH);
			const height = String(step.height ?? HEIGHT);
			const cwd = step.cwd ?? (await shell.cwd?.().catch(() => undefined));
			const at = cwd ? ["-c", cwd] : [];
			const env = Object.entries({
				COLORTERM: "truecolor",
				...step.env,
			}).flatMap(([key, value]) => [
				"-e",
				TerminalUtils.arg(`${key}=${value}`),
			]);
			// The program starts once the pane is set to outlive it, so even one
			// that exits at once leaves its screen and status to read.
			const created = tmux([
				"new-session",
				"-d",
				"-s",
				name,
				"-x",
				width,
				"-y",
				height,
				...at,
				";",
				"set-option",
				"-t",
				pane(name),
				OPENED,
				"1",
				";",
				"set-option",
				"-w",
				"-t",
				pane(name),
				"remain-on-exit",
				"on",
				";",
				// tmux's own "Pane is dead" line scrolls the last screen away.
				"set-option",
				"-q",
				"-w",
				"-t",
				pane(name),
				"remain-on-exit-format",
				"",
				";",
				"resize-window",
				"-t",
				pane(name),
				"-x",
				width,
				"-y",
				height,
				";",
				"respawn-pane",
				"-k",
				"-t",
				pane(name),
				...at,
				...env,
				TerminalUtils.arg(step.command),
			]);
			// Half set up, it would pass for one of the user's own sessions.
			await created.catch(async (error) => {
				await tmux(["kill-session", "-t", session(name)]).catch(() => {});
				throw error;
			});
			state.target = name;
			return { session: name, attach: `tmux attach -t ${name}` };
		}

		let target = state.target;
		if (!target) {
			const opened = (await sessions()).filter((s) => s.opened);
			if (opened.length !== 1)
				throw new Error(
					"There is no session to act on: open one, or name one with `session`.",
				);
			target = opened[0].name;
			state.target = target;
		}

		switch (step.action) {
			case "close": {
				await tmux(["kill-session", "-t", session(target)]);
				state.target = undefined;
				return undefined;
			}

			case "resize": {
				await tmux([
					"resize-window",
					"-t",
					pane(target),
					...(step.width ? ["-x", String(step.width)] : []),
					...(step.height ? ["-y", String(step.height)] : []),
				]);
				await sleep(SETTLE_MS, abort);
				return undefined;
			}

			case "type": {
				await live(target);
				if (step.paste) {
					await tmux([
						"set-buffer",
						"-b",
						"tiny-chat",
						"--",
						TerminalUtils.arg(step.text),
						";",
						"paste-buffer",
						"-p",
						"-d",
						"-b",
						"tiny-chat",
						"-t",
						pane(target),
					]);
				} else {
					await tmux([
						"send-keys",
						"-t",
						pane(target),
						"-l",
						"--",
						TerminalUtils.arg(step.text),
					]);
				}
				await sleep(SETTLE_MS, abort);
				return undefined;
			}

			case "press": {
				await live(target);
				const keys = step.keys
					.split(/\s+/)
					.filter(Boolean)
					.map(TerminalUtils.key);
				if (!keys.length) throw new Error("No keys to press.");
				const all = Array.from({ length: step.count ?? 1 }, () => keys).flat();
				await tmux(["send-keys", "-t", pane(target), ...all]);
				// A program cannot tell Escape from the start of the next key's
				// sequence until it has waited a moment for one.
				await sleep(all.at(-1) === "Escape" ? ESCAPE_MS : SETTLE_MS, abort);
				return undefined;
			}

			case "click": {
				const snap = await live(target);
				const { sgr } = mouse(snap);
				const at = locate(snap, TerminalUtils.match(step));
				const button = { left: 0, middle: 1, right: 2 }[step.button ?? "left"];
				for (let i = 0; i < (step.count ?? 1); i++) {
					for (const release of [false, true])
						await send(
							target,
							TerminalUtils.mouse({
								sgr,
								button,
								...at,
								release,
								modifiers: step.modifiers,
							}),
						);
				}
				await sleep(SETTLE_MS, abort);
				return at;
			}

			case "drag": {
				const snap = await live(target);
				const { sgr, motion } = mouse(snap);
				const from = locate(snap, TerminalUtils.match(step));
				const to = locate(snap, TerminalUtils.match(step.to));
				const event = (
					point: { row: number; col: number },
					kind: { release?: boolean; motion?: boolean } = {},
				) =>
					send(
						target,
						TerminalUtils.mouse({
							sgr,
							button: 0,
							...point,
							...kind,
							modifiers: step.modifiers,
						}),
					);
				await event(from);
				if (motion) {
					const count = Math.min(
						12,
						Math.max(Math.abs(to.row - from.row), Math.abs(to.col - from.col)),
					);
					for (let i = 1; i <= count; i++) {
						await sleep(10, abort);
						await event(
							{
								row: Math.round(from.row + ((to.row - from.row) * i) / count),
								col: Math.round(from.col + ((to.col - from.col) * i) / count),
							},
							{ motion: true },
						);
					}
				}
				await event(to, { release: true });
				await sleep(SETTLE_MS, abort);
				return { from, to };
			}

			case "scroll": {
				const snap = await live(target);
				const { sgr } = mouse(snap);
				const match = TerminalUtils.match(step);
				const at = TerminalUtils.isMatch(match)
					? locate(snap, match)
					: {
							row: Math.ceil(snap.height / 2),
							col: Math.ceil(snap.width / 2),
						};
				const dy = step.dy ?? (step.dx ? 0 : 3);
				const dx = step.dx ?? 0;
				const notches = [
					...Array<number>(Math.abs(dy)).fill(dy < 0 ? 64 : 65),
					...Array<number>(Math.abs(dx)).fill(dx < 0 ? 66 : 67),
				];
				await send(
					target,
					notches.flatMap((button) =>
						TerminalUtils.mouse({ sgr, button, ...at }),
					),
				);
				await sleep(SETTLE_MS, abort);
				return at;
			}

			case "expect": {
				const snap = await snapshot(target);
				const match = TerminalUtils.match(step);
				if (!TerminalUtils.isMatch(match))
					throw new Error(
						"Say what to expect: `text`, `regex`, or a cell's style.",
					);
				const found = TerminalUtils.find(snap.rows, match, snap.top);
				if (step.gone ? found.length : !found.length)
					throw new ScreenError(
						step.gone
							? `${TerminalUtils.describe(match)} is on screen (row ${found[0].row}, column ${found[0].col}).`
							: `Nothing on screen matches ${TerminalUtils.describe(match)}.`,
						snap,
					);
				return step.gone ? undefined : { ...found[0], count: found.length };
			}

			case "wait": {
				const match = TerminalUtils.match(step);
				const matching = TerminalUtils.isMatch(match);
				if (!matching && !step.stable && !step.exit) {
					await sleep(Math.min(step.ms ?? 1000, 60_000), abort);
					return { elapsed: elapsed() };
				}
				const timeout = Math.min(step.timeout ?? 10_000, 120_000);
				let last: string | undefined;
				let changed = Date.now();
				for (;;) {
					const snap = await snapshot(target);
					if (snap.text !== last) {
						last = snap.text;
						changed = Date.now();
					}
					if (step.exit) {
						if (snap.exited !== undefined)
							return { exited: snap.exited, elapsed: elapsed() };
					} else if (snap.exited !== undefined) {
						throw new ScreenError(
							`The program exited (status ${snap.exited}) while waiting.`,
							snap,
						);
					}
					const settled = !step.stable || Date.now() - changed >= step.stable;
					if (!step.exit && matching) {
						const found = TerminalUtils.find(snap.rows, match, snap.top);
						if (settled && (step.gone ? !found.length : found.length))
							return step.gone
								? { elapsed: elapsed() }
								: { ...found[0], elapsed: elapsed() };
					} else if (!step.exit && settled) {
						return { elapsed: elapsed() };
					}
					if (elapsed() >= timeout) {
						const what = step.exit
							? "the program to exit"
							: matching
								? `${TerminalUtils.describe(match)} to ${step.gone ? "go" : "appear"}`
								: `the screen to settle for ${step.stable}ms`;
						throw new ScreenError(
							`Timed out after ${timeout}ms waiting for ${what}.`,
							snap,
						);
					}
					await sleep(POLL_MS, abort);
				}
			}

			case "capture": {
				const frames = step.frames ?? 1;
				const numbers: number[] = [];
				let last: string | undefined;
				let snap: Snapshot | undefined;
				for (let i = 0; i < frames; i++) {
					if (i) await sleep(step.interval ?? 250, abort);
					snap = await snapshot(target, step.history);
					const key = `${snap.text}\n${JSON.stringify(snap.cursor)}`;
					if (key === last) continue;
					last = key;
					numbers.push(
						screen(screens, snap, {
							top: step.top,
							bottom: step.bottom,
							...(frames > 1 ? { at: elapsed() } : {}),
						}),
					);
				}
				const styles =
					step.styles && snap
						? TerminalUtils.styles(
								snap.rows.slice(
									Math.max(step.top ?? snap.top, snap.top) - snap.top,
									step.bottom === undefined
										? undefined
										: step.bottom - snap.top + 1,
								),
								Math.max(step.top ?? snap.top, snap.top),
							)
						: undefined;
				return {
					...(numbers.length === 1
						? { screen: numbers[0] }
						: { screens: numbers }),
					...(styles ? { styles } : {}),
				};
			}
		}
	};

	return { step, snapshot, screen, sessions };
};
