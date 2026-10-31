import type {
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

export const DataUtils = {
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

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];

			if (part.type === "text") {
				if (part.value.trim().length) renderedParts.push(part);
			} else if (part.type === "thought") {
				renderedParts.push({
					...part,
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
