import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { TypeUtils } from "#core/core/utils/TypeUtils.ts";
import type {
	zAbortPart,
	zData,
	zDataPart,
	zInterjectionPart,
	zThoughtPart,
	zToolCallPart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";

export type RenderedPart =
	| Exclude<zDataPart, { type: "thought" | "toolCall" | "toolResult" }>
	| (zThoughtPart & { active: boolean })
	| (zToolCallPart & {
			result?: zToolResultPart;
	  });

/** A run of consecutive parts of one type, told apart by `of`. */
export type RenderedPartGroup<T extends RenderedPart["type"][]> = {
	[K in T[number]]: {
		type: "group";
		of: K;
		value: Extract<RenderedPart, { type: K }>[];
	};
}[T[number]];

/** What the model is told where a reply it is working from was cut short. */
const CHECKPOINT_NOTICE =
	"[This reply was saved as a checkpoint while it was still being generated, and was interrupted before it finished. Work done after this point — including the effects of any tool calls cut off here — may have happened without being recorded above.]";

/** The result of a call a checkpoint caught before it returned. */
const CHECKPOINT_CALL_NOTICE =
	"Interrupted before this call returned: whether it took effect is unknown.";

export const DataUtils = {
	/** Whether `part` marks its reply as saved mid-generation. */
	isCheckpoint: (part: zDataPart): part is zAbortPart =>
		part.type === "abort" && part.reason === "checkpoint",

	/** What the model is told in place of a checkpoint's `abort` part. */
	getCheckpointNotice: () => CHECKPOINT_NOTICE,

	/**
	 * A copy of a reply still being generated, as it stands, to save in case
	 * the generation never finishes. Calls left half-written are dropped, and
	 * calls still running end on a result saying so, so the reply can be picked
	 * up again from here — except those in `awaiting`, still waiting on the
	 * user, which are left to be answered. It ends on a `checkpoint` abort.
	 */
	getCheckpoint: ({
		data,
		awaiting = () => false,
	}: {
		data: zData;
		awaiting?: (id: string) => boolean;
	}): zData => {
		const checkpoint = TypeUtils.deepClone(data);
		if (!checkpoint.length) checkpoint.push([]);
		const settled = new Set(
			checkpoint
				.flat()
				.filter((part) => part.type === "toolResult")
				.map((part) => part.id),
		);
		const parts = checkpoint[checkpoint.length - 1];
		const kept = parts.filter(
			(part) => !(part.type === "toolCall" && part.partial),
		);
		const cut = kept.filter(
			(part): part is zToolCallPart =>
				part.type === "toolCall" && !settled.has(part.id) && !awaiting(part.id),
		);
		parts.splice(
			0,
			parts.length,
			...kept,
			...cut.map(
				(call): zToolResultPart => ({
					id: call.id,
					type: "toolResult",
					name: call.name,
					error: true,
					output: [
						{
							id: CommonUtils.getRandomId(),
							type: "text",
							value: CHECKPOINT_CALL_NOTICE,
						},
					],
				}),
			),
			{
				id: CommonUtils.getRandomId(),
				type: "abort",
				reason: "checkpoint",
				message: "This reply was interrupted before it finished.",
			},
		);
		return checkpoint;
	},

	getText: ({ data, join = " " }: { data: zData; join?: string }): string => {
		return data
			.flat()
			.filter((p) => p.type === "text")
			.map((p) => p.value)
			.join(join);
	},

	getTextCleaned: ({
		data,
		maxLength = -1,
	}: {
		data: zData | string;
		maxLength?: number;
	}) => {
		if (typeof data !== "string") data = DataUtils.getText({ data });
		data = data
			.replace(/^[\s\n]*<message[^>]*>[\s\n]*|[\s\n]*<\/message>[\s\n]*$/g, "")
			.replace(/(:+)[a-zA-Z0-9-]+(?:\[.*?])?(?:{.*?})?([.\n]*)\1?/g, "$2") // Remove directives
			.replace(/!\[.*?]\(.*?\)/g, "") // Remove images
			.replace(/\[([^\]]+)]\((.*?)\)/g, "$1") // Remove links but keep text
			.replace(/(`{1,3})(.*?)\1/g, "$2") // Remove inline code and code blocks
			.replace(/(\*\*|__)(.*?)\1/g, "$2") // Remove bold
			.replace(/([*_])(.*?)\1/g, "$2") // Remove italics
			.replace(/~~(.*?)~~/g, "$1") // Remove strikethrough
			.replace(/^[\s#>*-]*#+\s+(.*)/g, "$1") // Remove headings
			.replace(/^[\s#>*-]*>\s+(.*)/g, "$1") // Remove blockquotes
			.replace(/^[\s#>*-]*[*-]\s+(.*)/g, "$1") // Remove unordered list markers
			.replace(/^[\s#>*-]*\d+\.\s*(.*)/g, "$1") // Remove ordered list markers
			.replace(/\n/g, " ") // Replace multiple newlines with a single newline
			.trim();
		if (maxLength > 0 && data.length > maxLength) {
			return `${data.substring(0, maxLength)}…`;
		}
		return data;
	},

	isMissingToolResult: ({ data }: { data: zData }) => {
		const parts = data.flat();
		const toolCallCount = parts.filter(
			(p) => p.type === "toolCall" && !p.partial,
		).length;
		const toolResultCount = parts.filter((p) => p.type === "toolResult").length;
		return toolResultCount < toolCallCount;
	},

	getRenderedParts: (data: zData, thinking = false) => {
		const parts = data.flat();
		const renderedParts: RenderedPart[] = [];

		// A provider numbers a step's thoughts from `0` again in every step, so
		// one that repeats an earlier step's id is told apart by its step: what
		// is drawn for each, and what the user opens of it, stays its own.
		const steps = data.flatMap((step, index) => step.map(() => index));
		const thoughts = new Set<string>();

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];

			if (part.type === "text") {
				if (part.value.trim().length) renderedParts.push(part);
			} else if (part.type === "thought") {
				const id = thoughts.has(part.id) ? `${part.id}@${steps[i]}` : part.id;
				thoughts.add(part.id);
				renderedParts.push({
					...part,
					id,
					active: thinking && i === parts.length - 1,
				});
			} else if (part.type === "toolCall") {
				// A background call shows the result it finished with, once it has.
				const finished = parts.find(
					(p): p is zInterjectionPart =>
						p.type === "interjection" && p.task?.id === part.id,
				);
				renderedParts.push({
					...part,
					result: finished?.task
						? {
								type: "toolResult",
								id: finished.task.id,
								name: finished.task.name,
								error: finished.task.error,
								output: finished.value,
								changes: finished.task.changes,
							}
						: parts.find(
								(p): p is zToolResultPart =>
									p.type === "toolResult" && p.id === part.id,
							),
				});
			} else if (part.type === "toolResult") {
				// skip
			} else if (part.type === "interjection" && part.task) {
				// shown as the result of the call it reports on
			} else {
				renderedParts.push(part);
			}
		}

		return renderedParts;
	},

	/**
	 * Groups parts into renderable chunks with additional UI state. Each run of
	 * consecutive parts of one of the `groups` types becomes one group; a part
	 * of another type, including another grouped one, ends the run.
	 */
	getRenderedPartsGrouped: <T extends RenderedPart["type"][]>(
		data: zData,
		thinking: boolean,
		...groups: T
	): (RenderedPart | RenderedPartGroup<T>)[] => {
		const parts = DataUtils.getRenderedParts(data, thinking);
		const renderedParts: (RenderedPart | RenderedPartGroup<T>)[] = [];

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];

			if (DataUtils.isGroupedPart(part, groups)) {
				const value: RenderedPart[] = [part];
				let end = i;
				while (end < parts.length - 1) {
					const nextPart = parts[end + 1];
					if (nextPart.type !== part.type) break;
					value.push(nextPart);
					end++;
				}
				renderedParts.push({
					type: "group",
					of: part.type,
					value,
				} as RenderedPartGroup<T>);
				i = end;
			} else {
				renderedParts.push(part);
			}
		}

		return renderedParts;
	},

	isGroupedPart: <T extends RenderedPart["type"][]>(
		part: RenderedPart,
		groups: T,
	): part is Extract<RenderedPart, { type: T[number] }> => {
		return (groups as readonly string[]).includes(part.type);
	},
} as const;
