import type { Nodes } from "mdast";
import { AgentStreamService } from "#client/core/services/StreamService.ts";
import type { FindSegment } from "#client/features/find/types/find.ts";
import { processor } from "#client/features/message/hooks/useMarkdown.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";
import {
	DataUtils,
	type RenderedPart,
} from "#core/features/data/utils/DataUtils.ts";
import {
	EditorPartUtils,
	type EditorRun,
} from "#core/features/data/utils/EditorPartUtils.ts";
import { DiffUtils } from "#core/features/file/utils/DiffUtils.ts";
import type { ToolBlock } from "#core/features/tool/types/display.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";

/** The agent's own `<message …>` wrapper, which is transport and never drawn. */
const MESSAGE_WRAPPER = /^\s*<message[^>]*>\n?|\n?<\/message>\s*$/g;

/** Nodes drawn as a line or paragraph of their own. */
const BLOCKS = new Set<Nodes["type"]>(["paragraph", "heading", "tableCell"]);

const lines = (text: string) => text.split("\n");

const textOf = (node: Nodes): string => {
	if ("value" in node && typeof node.value === "string") return node.value;
	if ("children" in node) return node.children.map(textOf).join("");
	return "";
};

const collect = (node: Nodes, blocks: string[]) => {
	if (BLOCKS.has(node.type)) blocks.push(textOf(node));
	else if (node.type === "code") blocks.push(...lines(node.value));
	else if (node.type === "math" || node.type === "html")
		blocks.push(node.value);
	else if ("children" in node)
		for (const child of node.children) collect(child, blocks);
};

/** A message's data as it is drawn: as far as it has streamed in. */
const dataOf = (message: MessageState) =>
	AgentStreamService.get(message.id)?.items.at(-1)?.data ?? message.data;

type ToolCallPart = Extract<RenderedPart, { type: "toolCall" }>;

/** Segments already read out of a message's data, by the toolsets read with. */
const cache = new WeakMap<Toolset<any>[], WeakMap<zData, FindSegment[]>>();

/**
 * The text find searches of what is not drawn, read out of the data it is
 * drawn from: close to what a reader sees, if never exactly — what is drawn
 * takes over as soon as it is.
 */
export const FindTextService = {
	/** Markdown as the text it is drawn as, a block to a paragraph or line. */
	markdown: (source: string): string[] => {
		const blocks: string[] = [];
		collect(processor.parse(source.replace(MESSAGE_WRAPPER, "")), blocks);
		return blocks;
	},

	run: (run: EditorRun): string[] =>
		run.flatMap((part) => {
			if (part.type === "text") return FindTextService.markdown(part.value);
			if (part.type === "quote" || part.type === "paste")
				return lines(part.text);
			return [EditorPartUtils.toText(part)];
		}),

	block: (block: ToolBlock, toolsets: Toolset<any>[]): string[] => {
		switch (block.type) {
			case "text":
				return lines(block.value);
			case "markdown":
				return FindTextService.markdown(block.value);
			case "code":
				return [...(block.title ? [block.title] : []), ...lines(block.value)];
			case "file":
				return [block.path, ...(block.content ? lines(block.content) : [])];
			case "diff":
				return [
					...(block.path ? [block.path] : []),
					...DiffUtils.lines(
						DiffUtils.context(
							DiffUtils.diff({ before: block.before, after: block.after }),
						),
					),
				];
			case "directory":
				return [block.path, ...block.entries.map((entry) => entry.path)];
			case "web":
				return [
					...(block.source.title ? [block.source.title] : []),
					block.source.url,
					...FindTextService.markdown(block.source.content),
				];
			case "record":
				return [
					block.title,
					...(block.description ? [block.description] : []),
					...(block.details ?? []),
				];
			case "json":
				return [
					...(block.title ? [block.title] : []),
					...lines(JSON.stringify(block.value, null, 2) ?? ""),
				];
			case "messages":
				return FindTextService.segments(block.data, toolsets).flatMap(
					(segment) => segment.blocks ?? [],
				);
		}
	},

	toolCall: (part: ToolCallPart, toolsets: Toolset<any>[]): string[] => {
		const display = ToolCallUtils.getDisplay({ part, toolsets });
		return [
			display.status.map((piece) => piece.text).join(""),
			...[...display.input, ...display.output].flatMap((block) =>
				FindTextService.block(block, toolsets),
			),
		];
	},

	/**
	 * A message's data as the segments both runtimes' `MessageParts` draw it
	 * in, keyed the way they key them: a run of text by its first part, a run
	 * of thoughts by its first thought, and each tool call by its own id.
	 */
	segments: (data: zData, toolsets: Toolset<any>[]): FindSegment[] => {
		let byData = cache.get(toolsets);
		if (!byData) {
			byData = new WeakMap();
			cache.set(toolsets, byData);
		}
		const cached = byData.get(data);
		if (cached) return cached;

		const segments: FindSegment[] = [];
		const parts = DataUtils.getRenderedPartsGrouped(
			data,
			false,
			"thought",
			"toolCall",
		);
		parts.forEach((part, index) => {
			if (EditorPartUtils.isRun(part)) {
				const previous = parts[index - 1];
				if (previous && EditorPartUtils.isRun(previous)) return;
				const run = EditorPartUtils.toRun(parts.slice(index));
				segments.push({ key: run[0].id, blocks: FindTextService.run(run) });
			} else if (part.type === "interjection") {
				segments.push({
					key: part.id,
					blocks: [
						"You",
						...FindTextService.segments([part.value], toolsets).flatMap(
							(segment) => segment.blocks ?? [],
						),
					],
				});
			} else if (part.type === "group" && part.of === "thought") {
				segments.push({
					key: part.value[0].id,
					blocks: FindTextService.markdown(
						part.value.map((thought) => thought.value).join("\n\n"),
					),
				});
			} else if (part.type === "group" && part.of === "toolCall") {
				for (const call of part.value)
					segments.push({
						key: call.id,
						blocks: FindTextService.toolCall(call, toolsets),
					});
			} else if (part.type === "abort") {
				segments.push({
					key: part.id,
					blocks: [
						`${part.reason === "error" ? "Failed" : "Stopped"}: ${part.reason}`,
						part.message ?? JSON.stringify(part.details),
					],
				});
			}
		});

		byData.set(data, segments);
		return segments;
	},

	/** Every segment of a list of messages, each as it is streaming in. */
	messages: function* (
		messages: MessageState[],
		toolsets: Toolset<any>[],
	): Generator<FindSegment> {
		for (const message of messages)
			yield* FindTextService.segments(dataOf(message), toolsets);
	},

	/** The message in a list that a segment of it is drawn in. */
	messageOf: (messages: MessageState[], key: string) =>
		messages.find((message) =>
			dataOf(message).some((step) =>
				step.some(
					(part) =>
						part.id === key ||
						(part.type === "interjection" && part.task?.id === key),
				),
			),
		),
} as const;
