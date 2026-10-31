import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	zDataSimplePart,
	zInterjectionPart,
	zTextPart,
	zToolCallPart,
} from "#core/features/data/types/part.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import type {
	ToolBlock,
	ToolCallContext,
	ToolCallDisplay,
	ToolCallState,
	ToolDisplay,
	ToolStatusPart,
	ToolStatusPiece,
} from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	Toolset,
} from "#core/features/tool/types/tool.ts";
import { ClaudeCodeToolUtils } from "#core/features/tool/utils/ClaudeCodeToolUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

type ToolCallPart = Extract<RenderedPart, { type: "toolCall" }>;

/** A call's status line before tense is applied, for combining with others. */
export interface ToolCallStatus {
	pieces: ToolStatusPiece[];
	pending: boolean;
}

/** Shown for tools without a display of their own, such as MCP tools. */
const fallback = (name: string): ToolDisplay<ToolDefinition> => ({
	status: () => [
		["Using", "Used"],
		{ count: ["tool", "tools"], subject: name },
	],
	input: ({ input }) =>
		input && typeof input === "object" && !Object.keys(input).length
			? []
			: [{ type: "json", value: input, title: "Input" }],
	output: ({ output, files }) => [
		...output.map((value): ToolBlock => ({ type: "json", value })),
		...files.flatMap((file) => ToolDisplayUtils.file({ file }) ?? []),
	],
});

/**
 * Status lines are read for every call in a message on every render, to build
 * the headers of each group of calls. They are derived only from the part's
 * `input`, `result` and `validation`, which are replaced whole and never
 * mutated, so those identities make a sound cache key.
 */
interface StatusCacheEntry {
	input: unknown;
	result: unknown;
	validation: unknown;
	partial: unknown;
	status: ToolCallStatus;
}

/** Keyed by toolsets first so a toolset change drops the whole cache. */
const statusCache = new WeakMap<
	Toolset<any>[],
	Map<string, StatusCacheEntry>
>();

const __rejection = {
	type: "text",
	value: "[Tool call rejected by user]",
} satisfies Omit<zTextPart, "id">;

const __interruption = {
	type: "text",
	value:
		"[Tool call interrupted by user. Wait for their instructions before trying it again.]",
} satisfies Omit<zTextPart, "id">;

const __background = "[Running in the background as task";

const isPending = (state: ToolCallState) =>
	state === "input" || state === "feedback" || state === "running";

const capitalize = (text: string, upper: boolean) =>
	text.charAt(0)[upper ? "toUpperCase" : "toLowerCase"]() + text.slice(1);

export const ToolCallUtils = {
	isRejection: (output: zDataSimplePart[]) => {
		return (
			output.length === 1 &&
			output[0].type === "text" &&
			output[0].value === __rejection.value
		);
	},

	getRejection: (): zDataSimplePart[] => {
		return [
			{
				id: CommonUtils.getRandomId(),
				...__rejection,
			},
		];
	},

	isInterruption: (output: zDataSimplePart[]) => {
		return (
			output.length === 1 &&
			output[0].type === "text" &&
			output[0].value === __interruption.value
		);
	},

	getInterruption: (): zDataSimplePart[] => {
		return [
			{
				id: CommonUtils.getRandomId(),
				...__interruption,
			},
		];
	},

	/** Whether a call asks to run in the background, and its tool can. */
	isBackgrounded: ({
		tool,
		part,
	}: {
		tool: Tool<any, any> | null | undefined;
		part: zToolCallPart;
	}) => !!tool?.background && part.input?.background === true,

	/** The result a background call settles with while it is still running. */
	isBackground: (output: zDataSimplePart[]) => {
		return (
			output.length === 1 &&
			output[0].type === "text" &&
			output[0].value.startsWith(__background)
		);
	},

	getBackground: ({ id }: { id: string }): zDataSimplePart[] => {
		return [
			{
				id: CommonUtils.getRandomId(),
				type: "text",
				value: `${__background} ${id}. Its result will be sent to you when it finishes, so carry on with other work meanwhile rather than waiting on it.]`,
			},
		];
	},

	/** What the model reads ahead of a background call's output. */
	getBackgroundNotice: ({
		task,
	}: {
		task: NonNullable<zInterjectionPart["task"]>;
	}): string => {
		return `[Background task ${task.id} (${task.name}) ${task.error ? "failed" : "finished"}. This is its result, not a message from the user.]`;
	},

	/**
	 * Settles with `promise`, or rejects as soon as `abort` fires. A tool that
	 * never looks at its signal (or a host that cannot stop what it started)
	 * still lets go of the loop the moment the user interrupts it.
	 */
	interruptible: <T>(promise: Promise<T>, abort?: AbortSignal): Promise<T> => {
		if (!abort) return promise;
		if (abort.aborted) return Promise.reject(abort.reason);
		return new Promise<T>((resolve, reject) => {
			const onAbort = () => reject(abort.reason);
			abort.addEventListener("abort", onAbort, { once: true });
			promise.then(resolve, reject).finally(() => {
				abort.removeEventListener("abort", onAbort);
			});
		});
	},

	getState: ({
		part,
		tool,
		running = false,
	}: {
		part: ToolCallPart;
		tool: Tool<any, any> | null;
		/** Whether the call is reporting output, which it only does once it runs. */
		running?: boolean;
	}): ToolCallState => {
		if (part.partial) return "input";
		if (part.result) {
			if (ToolCallUtils.isBackground(part.result.output)) return "running";
			if (part.result.error) return "error";
			if (ToolCallUtils.isRejection(part.result.output)) return "rejected";
			return "success";
		}
		// A call with fields to fill in waits on them, even without a tool of
		// Tiny Chat's behind it, as with Claude Code's own questions.
		const asks =
			tool?.feedback ||
			(!tool && !!ClaudeCodeToolUtils.getDisplay(part.name)?.fields);
		if ((asks || part.validation?.approval) && !running) return "feedback";
		return "running";
	},

	getContext: <T extends ToolDefinition>({
		part,
		state,
		stream = [],
	}: {
		part: ToolCallPart;
		state: ToolCallState;
		stream?: unknown[];
	}): ToolCallContext<T> => {
		const success = state === "success";
		return {
			state,
			input: part.input ?? {},
			output: success ? ToolUtils.json<T>(part.result, true) : [],
			files: success ? ToolUtils.file(part.result) : [],
			stream: stream as ToolCallContext<T>["stream"],
		};
	},

	getStatus: ({
		part,
		toolsets,
	}: {
		part: ToolCallPart;
		toolsets: Toolset<any>[];
	}): ToolCallStatus => {
		let cache = statusCache.get(toolsets);
		if (!cache) {
			cache = new Map();
			statusCache.set(toolsets, cache);
		}

		const cached = cache.get(part.id);
		if (
			cached &&
			cached.input === part.input &&
			cached.result === part.result &&
			cached.validation === part.validation &&
			cached.partial === part.partial
		) {
			return cached.status;
		}

		const { tool } = ToolUtils.find({ toolsets, part });
		const display =
			tool?.display ??
			ClaudeCodeToolUtils.getDisplay(part.name) ??
			fallback(part.name);
		const state = ToolCallUtils.getState({ part, tool });
		const status: ToolCallStatus = {
			pieces: display.status(ToolCallUtils.getContext({ part, state })),
			pending: isPending(state),
		};

		cache.set(part.id, {
			input: part.input,
			result: part.result,
			validation: part.validation,
			partial: part.partial,
			status,
		});
		return status;
	},

	getDisplay: ({
		part,
		toolsets,
		stream,
	}: {
		part: ToolCallPart;
		toolsets: Toolset<any>[];
		/** Output the call has reported so far, if it is running. */
		stream?: unknown[];
	}): ToolCallDisplay => {
		const { tool } = ToolUtils.find({ toolsets, part });
		const display =
			tool?.display ??
			ClaudeCodeToolUtils.getDisplay(part.name) ??
			fallback(part.name);
		const state = ToolCallUtils.getState({
			part,
			tool,
			running: stream !== undefined,
		});
		const context = ToolCallUtils.getContext({ part, state, stream });
		const pending = isPending(state);

		const texts =
			part.result?.output
				.filter((output) => output.type === "text")
				.map((output) => output.value) ?? [];

		let output: ToolBlock[] = [];
		if (
			state === "error" &&
			part.result &&
			ToolCallUtils.isInterruption(part.result.output)
		) {
			output = [{ type: "text", value: "Interrupted", tone: "dimmed" }];
		} else if (state === "error") {
			output = texts.map((value) => ({ type: "text", value, tone: "error" }));
		} else if (state === "rejected") {
			output = [{ type: "text", value: "Rejected", tone: "dimmed" }];
		} else if (state === "running" || state === "success") {
			output = [
				...(display.output?.(context) ?? []),
				// Notices a tool leaves beside its output — truncation, summaries.
				...texts.map(
					(value): ToolBlock =>
						tool?.display
							? { type: "text", value, tone: "dimmed" }
							: { type: "code", value },
				),
			];
		}

		return {
			id: part.id,
			name: tool?.name ?? part.name,
			state,
			active: pending,
			status: ToolCallUtils.resolveStatus({
				pieces: display.status(context),
				pending,
			}),
			input: display.input?.(context) ?? [],
			output,
			controls:
				state === "feedback"
					? {
							approval: !!part.validation?.approval,
							fields: display.fields?.(context) ?? [],
						}
					: undefined,
		};
	},

	/**
	 * A run of tool calls, as it is shown: the line that stands for all of it
	 * once collapsed. It is `pending` while any call in it is still streaming,
	 * running or waiting on the user.
	 */
	getGroup: ({
		parts,
		toolsets,
	}: {
		parts: ToolCallPart[];
		toolsets: Toolset<any>[];
	}) => {
		const statuses = parts.map((part) =>
			ToolCallUtils.getStatus({ part, toolsets }),
		);
		return {
			calls: statuses.length,
			status: statuses.length ? ToolCallUtils.resolveSummary(statuses) : [],
			pending: statuses.some((status) => status.pending),
		};
	},

	/** One call's status line. */
	resolveStatus: ({ pieces, pending }: ToolCallStatus): ToolStatusPart[] => {
		return pieces.flatMap((piece): ToolStatusPart | [] => {
			if (typeof piece === "string") return { text: piece };
			if (Array.isArray(piece)) return { text: piece[pending ? 0 : 1] };
			if ("count" in piece) {
				return piece.subject !== undefined
					? { text: piece.subject, subject: true }
					: { text: piece.count[0] };
			}
			return { text: piece.subject, subject: true };
		});
	},

	/**
	 * The status line for a run of calls. Calls whose pieces agree up to their
	 * `count` are counted together, in the order they first appear:
	 * `Read file a.txt` + `Read file b.txt` + `Edit file a.txt` reads as
	 * `Read 2 files, edited 1 file`.
	 */
	resolveSummary: (statuses: ToolCallStatus[]): ToolStatusPart[] => {
		if (statuses.length === 1) return ToolCallUtils.resolveStatus(statuses[0]);

		const kinds = new Map<
			string,
			{ pieces: ToolStatusPiece[]; count: number; pending: boolean }
		>();

		for (const status of statuses) {
			let end = status.pieces.findIndex(
				(piece) => typeof piece === "object" && "count" in piece,
			);
			// Without a noun to count by, a call is only counted as a tool.
			const pieces: ToolStatusPiece[] =
				end === -1
					? [["Using", "Used"], { count: ["tool", "tools"] }]
					: status.pieces.slice(0, end + 1);
			end = pieces.length - 1;

			const key = JSON.stringify(
				pieces.map((piece) =>
					typeof piece === "object" && "count" in piece ? piece.count : piece,
				),
			);
			const kind = kinds.get(key) ?? { pieces, count: 0, pending: false };
			kind.count++;
			kind.pending ||= status.pending;
			kinds.set(key, kind);
		}

		const parts: ToolStatusPart[] = [];
		for (const { pieces, count, pending } of kinds.values()) {
			const first = !parts.length;
			const previous = parts.at(-1);
			if (previous) {
				parts[parts.length - 1] = { ...previous, text: `${previous.text},` };
			}

			const resolved = pieces.map((piece): ToolStatusPart => {
				if (typeof piece === "string") return { text: piece };
				if (Array.isArray(piece)) return { text: piece[pending ? 0 : 1] };
				if ("count" in piece) {
					return {
						text: `${count} ${piece.count[count === 1 ? 0 : 1]}`,
						subject: true,
					};
				}
				return { text: piece.subject, subject: true };
			});
			if (resolved[0] && !resolved[0].subject) {
				resolved[0] = {
					...resolved[0],
					text: capitalize(resolved[0].text, first),
				};
			}
			parts.push(...resolved);
		}

		return parts;
	},
};
