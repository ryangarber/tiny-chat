import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import type {
	zDataPart,
	zDataSimplePart,
	zSignature,
	zToolCallPart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";
import { TranscriptUtils } from "#core/features/data/utils/TranscriptUtils.ts";
import {
	CLAUDE_CODE_TOOL_PREFIX,
	type ClaudeCodeBlock,
	type ClaudeCodeMessage,
	type ClaudeCodeToolContent,
} from "#core/features/provider/types/claudeCode.ts";
import type { zModelMessage } from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

/** What a part's signature names as its model, to find Claude Code's sessions by. */
export const CLAUDE_CODE_SIGNATURE = "claude-code";

/** The file types Claude reads as they are; others are sent as text. */
const SUPPORTED_FILES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
];

type Block = { type: string; [key: string]: any };

/** The index after the last reply before the one being made. */
const getPromptStart = (messages: zModelMessage[]) => {
	const reply = messages.length - 1;
	for (let i = reply - 1; i >= 0; i--)
		if (messages[i].author !== "USER") return i + 1;
	return 0;
};

export const ClaudeCodeUtils = {
	/** A Tiny Chat tool's name, from what Claude Code calls it. */
	getToolName: (name: string) =>
		name.startsWith(CLAUDE_CODE_TOOL_PREFIX)
			? name.slice(CLAUDE_CODE_TOOL_PREFIX.length)
			: name,

	/**
	 * The session the previous reply ran in, if Claude Code made it. A reply
	 * from another model, or none, means there is nothing to resume.
	 */
	getSession: (messages: zModelMessage[]): string | undefined => {
		const previous = messages[getPromptStart(messages) - 1];
		if (!previous) return undefined;
		const signed = previous.data
			.flat()
			.findLast(
				(part) =>
					part.signature?.model === CLAUDE_CODE_SIGNATURE &&
					part.signature.item,
			);
		return signed?.signature?.item;
	},

	/** The chat before the prompt, for a session that starts over. */
	getHistory: (messages: zModelMessage[]): string | undefined => {
		const earlier = messages.slice(0, getPromptStart(messages));
		const blocks = earlier
			.map((message) => {
				const body = message.data
					.flat()
					.flatMap((part) => TranscriptUtils.part(part))
					.join("\n\n")
					.trim();
				if (!body) return null;
				return `## ${message.author === "USER" ? "User" : "Assistant"}\n\n${body}`;
			})
			.filter((block) => block !== null);
		if (!blocks.length) return undefined;
		return [
			"<conversation_history>",
			"This conversation started before this session. What was said so far:",
			...blocks,
			"</conversation_history>",
		].join("\n\n");
	},

	/** The user's new turn, as content blocks. */
	getPrompt: async (messages: zModelMessage[]): Promise<ClaudeCodeBlock[]> => {
		const prompt = messages
			.slice(getPromptStart(messages), -1)
			.flatMap((message) => message.data.flat());
		// Messages the user queued before the run began are already in the reply.
		const queued = (messages[messages.length - 1]?.data.flat() ?? []).flatMap(
			(part) => (part.type === "interjection" && !part.task ? part.value : []),
		);
		const blocks = await ClaudeCodeUtils.getBlocksOf([...prompt, ...queued]);
		// Adjacent text reads as one block, as the user wrote it.
		const merged: ClaudeCodeBlock[] = [];
		for (const block of blocks) {
			const last = merged[merged.length - 1];
			if (block.type === "text" && last?.type === "text")
				last.text = `${last.text}\n${block.text}`;
			else merged.push(block);
		}
		return merged.filter((block) => block.type !== "text" || block.text);
	},

	getBlocksOf: async (parts: zDataPart[]): Promise<ClaudeCodeBlock[]> => {
		const blocks: ClaudeCodeBlock[] = [];
		for (const part of parts)
			blocks.push(...(await ClaudeCodeUtils.getBlocks(part)));
		return blocks;
	},

	getBlocks: async (part: zDataPart): Promise<ClaudeCodeBlock[]> => {
		if (part.type === "text") return [{ type: "text", text: part.value }];
		if (part.type === "file") {
			const file = await ModelProviderUtils.getPartTransformed({
				part,
				supportedFileTypes: SUPPORTED_FILES,
			});
			if (file.type === "text") return [{ type: "text", text: file.value }];
			if (file.type !== "file") return [];
			if (file.mime === "application/pdf")
				return [
					{
						type: "document",
						source: {
							type: "base64",
							media_type: "application/pdf",
							data: file.data,
						},
						title: file.name,
					},
				];
			return [
				{
					type: "image",
					source: { type: "base64", media_type: file.mime, data: file.data },
				},
			];
		}
		if (part.type === "json")
			return [{ type: "text", text: JSON.stringify(part.value) }];
		return TranscriptUtils.part(part).map((text) => ({ type: "text", text }));
	},

	/** A Tiny Chat tool result, as an MCP tool result. */
	toToolContent: (result: zToolResultPart): ClaudeCodeToolContent[] => {
		const content = result.output.flatMap((part): ClaudeCodeToolContent[] => {
			if (part.type === "text") return [{ type: "text", text: part.value }];
			if (part.type === "json")
				return [{ type: "text", text: JSON.stringify(part.value) }];
			if (part.type === "file") {
				if (part.mime.startsWith("image/"))
					return [{ type: "image", data: part.data, mimeType: part.mime }];
				const text = part.mime.startsWith("text/")
					? new TextDecoder().decode(
							Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0)),
						)
					: `[file${part.name ? `: ${part.name}` : ""} (${part.mime})]`;
				return [{ type: "text", text }];
			}
			return TranscriptUtils.part(part).map((text) => ({ type: "text", text }));
		});
		return content.length ? content : [{ type: "text", text: "(no output)" }];
	},

	/** A tool result's content, as Claude Code reports it. */
	fromToolContent: (content: unknown): zDataSimplePart[] => {
		if (typeof content === "string")
			return [{ id: CommonUtils.getRandomId(), type: "text", value: content }];
		if (!Array.isArray(content)) return [];
		return content.flatMap((block: Block): zDataSimplePart[] => {
			if (block.type === "text" && typeof block.text === "string")
				return [
					{ id: CommonUtils.getRandomId(), type: "text", value: block.text },
				];
			if (block.type === "image" && block.source?.type === "base64")
				return [
					{
						id: CommonUtils.getRandomId(),
						type: "file",
						mime: block.source.media_type ?? "image/png",
						data: block.source.data ?? "",
					},
				];
			return [];
		});
	},

	/**
	 * Reads one run's messages as the generation's events. It keeps what it
	 * has seen: which blocks are text, thinking or calls, and the calls
	 * Tiny Chat answered itself, whose echoed results it skips.
	 */
	createReader: () => {
		let session: string | undefined;
		let message = "";
		/** A step's blocks, by index: what they are and, for calls, their id. */
		const blocks = new Map<number, { type: string; id?: string }>();
		const calls = new Map<string, zToolCallPart>();
		const answered = new Set<string>();
		/** The kind of block last read, and the text block that came last. */
		let last: { type?: string; text?: string } = {};

		const signature = (): zSignature | undefined =>
			session ? { model: CLAUDE_CODE_SIGNATURE, item: session } : undefined;

		const read = (event: ClaudeCodeMessage): zAgentEvent[] => {
			if (event.type === "system") {
				const system = event as Extract<ClaudeCodeMessage, { type: "system" }>;
				if (system.subtype === "init" && system.session_id)
					session = system.session_id;
				return [];
			}

			// A subagent's own work shows only as its call and result.
			if ("parent_tool_use_id" in event && event.parent_tool_use_id) return [];

			if (event.type === "stream_event") {
				const { event: stream } = event as Extract<
					ClaudeCodeMessage,
					{ type: "stream_event" }
				>;
				if (stream.type === "message_start" && stream.message) {
					message = stream.message.id;
					blocks.clear();
					return [{ type: "start", warnings: [] }];
				}
				if (stream.index === undefined) return [];
				const id = `${message}:${stream.index}`;
				if (stream.type === "content_block_start" && stream.content_block) {
					const block = stream.content_block;
					if (block.type === "tool_use") last = { type: "tool_use" };
					blocks.set(stream.index, { type: block.type, id: block.id });
					if (block.type === "tool_use" && block.id && block.name)
						return [
							{
								type: "toolInput",
								id: block.id,
								name: ClaudeCodeUtils.getToolName(block.name),
							},
						];
					return [];
				}
				if (stream.type === "content_block_delta" && stream.delta) {
					const delta = stream.delta;
					if (delta.type === "text_delta" && delta.text) {
						// Text right after another turn's text would run into it.
						const value =
							last.type === "text" && last.text !== id
								? `\n\n${delta.text}`
								: delta.text;
						last = { type: "text", text: id };
						return [
							{
								type: "data",
								value: { type: "text", id, value, signature: signature() },
							},
						];
					}
					if (delta.type === "thinking_delta" && delta.thinking) {
						last = { type: "thought" };
						return [
							{
								type: "data",
								value: {
									type: "thought",
									id,
									value: delta.thinking,
									signature: signature(),
								},
							},
						];
					}
					const call = blocks.get(stream.index)?.id;
					if (delta.type === "input_json_delta" && call && delta.partial_json)
						return [{ type: "toolInput", id: call, delta: delta.partial_json }];
				}
				return [];
			}

			if (event.type === "assistant") {
				const { message } = event as Extract<
					ClaudeCodeMessage,
					{ type: "assistant" }
				>;
				return message.content.flatMap((block): zAgentEvent[] => {
					if (block.type !== "tool_use" || !block.id || !block.name) return [];
					const part: zToolCallPart = {
						type: "toolCall",
						id: block.id,
						name: ClaudeCodeUtils.getToolName(block.name),
						input: block.input ?? {},
						signature: signature(),
					};
					calls.set(part.id, part);
					return [{ type: "data", value: part }];
				});
			}

			if (event.type === "user") {
				const { message } = event as Extract<
					ClaudeCodeMessage,
					{ type: "user" }
				>;
				if (typeof message.content === "string") return [];
				return message.content.flatMap((block): zAgentEvent[] => {
					const id = block.tool_use_id;
					if (block.type !== "tool_result" || !id || answered.has(id))
						return [];
					return [
						{
							type: "data",
							value: {
								type: "toolResult",
								id,
								name: calls.get(id)?.name ?? "tool",
								output: ClaudeCodeUtils.fromToolContent(block.content),
								error: block.is_error || undefined,
								signature: signature(),
							},
						},
					];
				});
			}

			if (event.type === "result") {
				const result = event as Extract<ClaudeCodeMessage, { type: "result" }>;
				const events: zAgentEvent[] = [];
				if (result.is_error && result.subtype !== "success")
					events.push({
						type: "data",
						value: {
							id: CommonUtils.getRandomId(),
							type: "abort",
							reason: "error",
							message: result.errors?.join("\n") || result.subtype,
							details: "",
						},
					});
				events.push({
					type: "end",
					metadata: [
						{
							claudeCode: {
								session: result.session_id,
								costUsd: result.total_cost_usd,
								usage: result.usage,
							},
						},
					],
				});
				return events;
			}

			return [];
		};

		return {
			read,
			/** The call Claude Code asks about, as streamed. */
			getCall: (id: string) => calls.get(id),
			/** Marks a call Tiny Chat answers itself. */
			answer: (id: string) => answered.add(id),
			signature,
		};
	},
} as const;
