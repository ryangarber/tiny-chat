import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	zDataSimplePart,
	zInterjectionPart,
	zTextPart,
	zToolCallPart,
} from "#core/features/data/types/part.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
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
import { CodexToolUtils } from "#core/features/tool/utils/CodexToolUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";
import { ToolOutputUtils } from "#core/features/tool/utils/ToolOutputUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

type ToolCallPart = Extract<RenderedPart, { type: "toolCall" }>;

/** A call's status line before tense is applied, for combining with others. */
export interface ToolCallStatus {
	pieces: ToolStatusPiece[];
	pending: boolean;
}

/** How an agent's own tool (Claude Code's, Codex's) is shown, if it is one. */
const getAgentDisplay = (name: string) =>
	ClaudeCodeToolUtils.getDisplay(name) ?? CodexToolUtils.getDisplay(name);

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

/** An image a call produced, ready to draw. */
export interface ToolCallImage {
	src: string;
	name?: string;
}

/**
 * Images found in a result, keyed by the result, which is replaced whole and
 * never mutated, so a screenshot's data URL is built once rather than on every
 * render of its status line.
 */
const imageCache = new WeakMap<object, ToolCallImage[]>();

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

	/**
	 * Whether what a call changes in the user's repositories is looked for:
	 * as its tool says, as an agent's own tool's display says, and otherwise
	 * yes, since a tool nothing is known about (an MCP server's, through an
	 * agent) may change anything.
	 */
	tracksChanges: ({
		tool,
		name,
	}: {
		tool: Tool<any, any> | null | undefined;
		name: string;
	}): boolean => {
		if (tool) return !!tool.tracksChanges;
		const display = getAgentDisplay(name);
		return display ? !!display.tracksChanges : true;
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
		// A call with fields to fill in waits on them.
		const asks =
			tool?.feedback || (!tool && !!getAgentDisplay(part.name)?.fields);
		// Answered, a call the provider runs itself is its to run.
		const approving =
			part.validation?.approval && part.validation.approved === undefined;
		if ((asks || approving) && !running) return "feedback";
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
			tool?.display ?? getAgentDisplay(part.name) ?? fallback(part.name);
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
		/** An agent's own tool's, for a call no Tiny Chat tool made. */
		const agentDisplay = tool ? undefined : getAgentDisplay(part.name);
		const display = tool?.display ?? agentDisplay ?? fallback(part.name);
		const state = ToolCallUtils.getState({
			part,
			tool,
			running: stream !== undefined,
		});
		const context = ToolCallUtils.getContext({ part, state, stream });
		const pending = isPending(state);

		// Tiny Chat's own tools clean their output on the way in; an agent's own
		// (Claude Code's `Bash`) or an MCP server's comes as the terminal wrote
		// it, colors, CRLF line endings and all.
		const texts =
			part.result?.output
				.filter((output) => output.type === "text")
				.map((output) =>
					tool?.display
						? output.value
						: ToolOutputUtils.getPlain(output.value.replace(/\r\n/g, "\n")),
				) ?? [];

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
				...texts.map((value): ToolBlock => {
					// Beside a file an agent's call read, its text is a notice
					// (`PDF file read: …`) rather than output of its own.
					if (tool?.display || (agentDisplay && context.files.length))
						return { type: "text", value, tone: "dimmed" };
					// An agent's own call answered in prose, such as a subagent.
					if (agentDisplay?.text?.prose)
						return {
							type: "messages",
							data: [[{ id: `${part.id}:result`, type: "text", value }]],
						};
					return { type: "code", value, title: agentDisplay?.text?.title };
				}),
			];
		}

		// What the call changed, found beside it. These are the file as it now
		// stands, so they stand in for an agent's own preview of the same edit.
		const changes =
			state === "rejected"
				? []
				: ToolDisplayUtils.changes(part.result?.changes);
		const changed = new Set(
			changes.flatMap((block) =>
				block.type === "diff" && block.path ? [block.path] : [],
			),
		);
		let input = display.input?.(context) ?? [];
		if (changed.size && agentDisplay)
			input = input.filter(
				(block) =>
					!(
						(block.type === "diff" || block.type === "file") &&
						block.path &&
						[...changed].some((path) =>
							PathUtils.equals(path, block.path ?? ""),
						)
					),
			);

		return {
			id: part.id,
			name: tool?.name ?? part.name,
			state,
			active: pending,
			status: ToolCallUtils.resolveStatus({
				pieces: display.status(context),
				pending,
			}),
			input,
			output: [...output, ...changes],
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
			images: parts.flatMap((part) => ToolCallUtils.getImages(part)),
		};
	},

	/**
	 * The images a call produced — a screenshot, an image file it read. Every
	 * image a tool shows comes back as a file in its result, so they are read
	 * from there, without resolving the call's whole display.
	 */
	getImages: (part: ToolCallPart): ToolCallImage[] => {
		const { result } = part;
		if (!result || result.error) return [];
		const cached = imageCache.get(result);
		if (cached) return cached;
		const images = ToolUtils.file(result)
			.filter((file) => file.mime.startsWith("image/"))
			.map((file) => ({
				src: `data:${file.mime};base64,${file.data}`,
				name: file.name,
			}));
		imageCache.set(result, images);
		return images;
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
