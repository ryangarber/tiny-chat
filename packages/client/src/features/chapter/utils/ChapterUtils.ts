import type { Chapter } from "#client/features/chapter/types/chapter.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";
import {
	DataUtils,
	type RenderedPart,
} from "#core/features/data/utils/DataUtils.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

type ChapterMessage = Pick<MessageState, "id" | "author" | "data">;
type ToolCallPart = Extract<RenderedPart, { type: "toolCall" }>;

/** Characters a chapter's label is cut to. */
const LABEL_LENGTH = 80;

/**
 * A message's calls, by its data, which a saved message keeps and a streaming
 * one replaces whole on every flush: a long chat is read once, and only the
 * reply being written is read again as it changes.
 */
const callsCache = new WeakMap<zData, ToolCallPart[]>();

const getCalls = (message: ChapterMessage) => {
	let calls = callsCache.get(message.data);
	if (!calls) {
		calls = DataUtils.getRenderedParts(message.data).filter(
			(part): part is ToolCallPart => part.type === "toolCall" && !part.partial,
		);
		callsCache.set(message.data, calls);
	}
	return calls;
};

const labelCache = new WeakMap<zData, string>();

/** What the user said, in a line: its prose, or what it attached. */
const getLabel = (message: ChapterMessage) => {
	let label = labelCache.get(message.data);
	if (label === undefined) {
		// Code and tables say little in a line.
		const prose = DataUtils.getText({ data: message.data, join: "\n" })
			.replace(/```[\s\S]*?(?:```|$)/g, " ")
			.replace(/^\s*\|.*$/gm, " ");
		label = DataUtils.getTextCleaned({ data: prose, maxLength: LABEL_LENGTH });
		if (!label) {
			const attachment = DataUtils.getRenderedParts(message.data).find(
				(part) => part.type === "attachment",
			);
			label = attachment?.type === "attachment" ? attachment.label : "";
		}
		labelCache.set(message.data, label);
	}
	return label || "Message";
};

/** Whether a call could still be going: it has no result, or only the placeholder of a background run. */
const isUnsettled = (part: ToolCallPart) =>
	!part.result || ToolCallUtils.isBackground(part.result.output);

export const ChapterUtils = {
	/**
	 * The ids of every call that could still be going, for the caller to
	 * watch the streams of. A call is only taken to be running while its
	 * stream is open, which a call cut off by the app closing never is again.
	 */
	getCandidates: (messages: ChapterMessage[]): string[] =>
		messages.flatMap((message) =>
			getCalls(message)
				.filter(isUnsettled)
				.map((part) => part.id),
		),

	/**
	 * In order: a chapter for every message of the user's, and one for every
	 * call still going in any message.
	 */
	getChapters: ({
		messages,
		toolsets,
		live,
	}: {
		messages: ChapterMessage[];
		toolsets: Toolset<any>[];
		/** Calls whose output is still streaming. */
		live: ReadonlySet<string>;
	}): Chapter[] =>
		messages.flatMap((message, index) => {
			const chapters: Chapter[] = [];
			if (message.author === "USER")
				chapters.push({
					type: "message",
					key: message.id,
					messageId: message.id,
					index,
					label: getLabel(message),
				});
			for (const part of getCalls(message)) {
				if (!isUnsettled(part)) continue;
				const running = live.has(part.id);
				const state = ToolCallUtils.getState({
					part,
					tool: ToolUtils.find({ toolsets, part }).tool,
					running,
				});
				if (state !== "running" && state !== "feedback") continue;
				if (state === "running" && !running) continue;
				const status = ToolCallUtils.getStatus({ part, toolsets });
				chapters.push({
					type: "toolCall",
					key: `${message.id}/${part.id}`,
					id: part.id,
					messageId: message.id,
					index,
					label: ToolCallUtils.resolveStatus({ ...status, pending: true })
						.map((piece) => piece.text)
						.join(" "),
					state,
				});
			}
			return chapters;
		}),

	/**
	 * Whether two lists mark the same places, so a reply streaming in only
	 * moves the rail when what it shows has actually changed.
	 */
	isSame: (a: Chapter[], b: Chapter[]): boolean =>
		a.length === b.length &&
		a.every((chapter, at) => {
			const other = b[at];
			return (
				chapter.key === other.key &&
				chapter.index === other.index &&
				chapter.label === other.label &&
				(chapter.type === "toolCall" && other.type === "toolCall"
					? chapter.state === other.state
					: chapter.type === other.type)
			);
		}),

	/**
	 * Where each of `count` marks sits on a track `track` long when they are
	 * simply listed in order: `gap` apart, or closer where that many don't fit,
	 * with the list centered on the track. It depends on nothing but the two,
	 * so marks stay put however the content beneath them is laid out.
	 */
	stack: ({
		count,
		track,
		gap,
	}: {
		count: number;
		track: number;
		gap: number;
	}): number[] => {
		if (count <= 0 || track <= 0) return [];
		const spacing = count > 1 ? Math.min(gap, track / (count - 1)) : 0;
		const start = (track - spacing * (count - 1)) / 2;
		return Array.from({ length: count }, (_, at) => start + at * spacing);
	},

	/**
	 * Where each mark sits on a track `track` long, from where in content
	 * `content` long the thing it marks starts — as a scrollbar's handle would
	 * sit to show it. Marks are kept `gap` apart, pushed down past the one
	 * above and then back up off the end of the track; where there are more
	 * than the track holds that far apart, they keep where they would be and
	 * are left to overlap.
	 *
	 * Units are the caller's: pixels in a browser, rows in a terminal (where
	 * `round` keeps every mark on a row).
	 */
	place: ({
		tops,
		content,
		track,
		gap,
		round = false,
	}: {
		tops: number[];
		content: number;
		track: number;
		gap: number;
		round?: boolean;
	}): number[] => {
		if (!tops.length || content <= 0 || track <= 0) return tops.map(() => 0);
		const end = Math.max(0, track - gap);
		const at = (top: number) => {
			const position = Math.min(Math.max((top / content) * track, 0), end);
			return round ? Math.floor(position) : position;
		};
		const natural = tops.map(at);
		if ((tops.length - 1) * gap > end) return natural;

		const placed = [...natural];
		for (let index = 1; index < placed.length; index++)
			placed[index] = Math.max(placed[index], placed[index - 1] + gap);
		placed[placed.length - 1] = Math.min(placed[placed.length - 1], end);
		for (let index = placed.length - 2; index >= 0; index--)
			placed[index] = Math.min(placed[index], placed[index + 1] - gap);
		return placed;
	},

	/**
	 * The chapter being read: the last to start at or above `at` — the top of
	 * the viewport, give or take — or the first if none has.
	 */
	getCurrent: ({ tops, at }: { tops: number[]; at: number }): number => {
		let current = tops.length ? 0 : -1;
		for (let index = 0; index < tops.length; index++)
			if (tops[index] <= at) current = index;
		return current;
	},
} as const;
