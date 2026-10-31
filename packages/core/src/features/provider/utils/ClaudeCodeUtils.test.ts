import { describe, expect, it } from "vitest";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import type { ClaudeCodeMessage } from "#core/features/provider/types/claude.ts";
import type { zModelMessage } from "#core/features/provider/types/model.ts";
import {
	CLAUDE_CODE_SIGNATURE,
	ClaudeCodeUtils,
} from "#core/features/provider/utils/ClaudeCodeUtils.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";

const text = (value: string, session?: string) => ({
	id: crypto.randomUUID(),
	type: "text" as const,
	value,
	signature: session
		? { model: CLAUDE_CODE_SIGNATURE, item: session }
		: undefined,
});

const chat = (...messages: [zModelMessage["author"], string, string?][]) =>
	messages.map(
		([author, value, session]): zModelMessage => ({
			author,
			data: [[text(value, session)]],
		}),
	);

describe("ClaudeCodeUtils", () => {
	it("resumes only the reply right before the prompt", () => {
		const resumed = chat(
			["USER", "hi"],
			["MODEL", "hello", "s1"],
			["USER", "again"],
			["MODEL", ""],
		);
		expect(ClaudeCodeUtils.getSession(resumed)).toBe("s1");

		const switched = chat(
			["USER", "hi"],
			["MODEL", "hello", "s1"],
			["USER", "and"],
			["MODEL", "from another model"],
			["USER", "again"],
			["MODEL", ""],
		);
		expect(ClaudeCodeUtils.getSession(switched)).toBeUndefined();
	});

	it("sends every queued user message as the prompt, and the rest as history", async () => {
		const messages = chat(
			["USER", "first"],
			["MODEL", "reply"],
			["USER", "second"],
			["USER", "third"],
			["MODEL", ""],
		);
		expect(await ClaudeCodeUtils.getPrompt(messages)).toEqual([
			{ type: "text", text: "second\nthird" },
		]);
		const history = ClaudeCodeUtils.getHistory(messages) ?? "";
		expect(history).toContain("first");
		expect(history).toContain("reply");
		expect(history).not.toContain("second");
	});

	it("reads a run's stream as text, thought, calls and results", () => {
		const reader = ClaudeCodeUtils.createReader();
		const messages: ClaudeCodeMessage[] = [
			{ type: "system", subtype: "init", session_id: "s2" },
			{
				type: "stream_event",
				parent_tool_use_id: null,
				event: { type: "message_start", message: { id: "m1" } },
			},
			{
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "thinking_delta", thinking: "hmm" },
				},
			},
			{
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "t1",
						name: "mcp__tinychat__read_file",
					},
				},
			},
			{
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"path":' },
				},
			},
			{
				type: "assistant",
				parent_tool_use_id: null,
				message: {
					id: "m1",
					content: [
						{
							type: "tool_use",
							id: "t1",
							name: "mcp__tinychat__read_file",
							input: { path: "a" },
						},
					],
				},
			},
			{
				type: "user",
				parent_tool_use_id: null,
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "t1",
							content: [{ type: "text", text: "contents" }],
						},
					],
				},
			},
			// A subagent's work stays inside its call.
			{
				type: "assistant",
				parent_tool_use_id: "t9",
				message: {
					id: "m2",
					content: [{ type: "tool_use", id: "t2", name: "Bash" }],
				},
			},
			{
				type: "result",
				subtype: "success",
				is_error: false,
				session_id: "s2",
				total_cost_usd: 0.001,
			},
		];
		const events = messages.flatMap((message) => reader.read(message));
		const types = events.map((event: zAgentEvent) =>
			event.type === "data" ? event.value.type : event.type,
		);
		expect(types).toEqual([
			"start",
			"thought",
			"toolInput",
			"toolInput",
			"toolCall",
			"toolResult",
			"end",
		]);
		const call = events.find(
			(e) => e.type === "data" && e.value.type === "toolCall",
		);
		expect(call?.type === "data" && call.value).toMatchObject({
			name: "read_file",
			input: { path: "a" },
			signature: { model: CLAUDE_CODE_SIGNATURE, item: "s2" },
		});
	});

	it("keeps a later turn's text apart from the text before it", () => {
		const reader = ClaudeCodeUtils.createReader();
		const turn = (message: string, text: string): ClaudeCodeMessage[] => [
			{
				type: "stream_event",
				parent_tool_use_id: null,
				event: { type: "message_start", message: { id: message } },
			},
			{
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text },
				},
			},
		];
		const texts = [
			...turn("m1", "one"),
			...turn("m1", " more"),
			...turn("m2", "two"),
		]
			.flatMap((message) => reader.read(message))
			.flatMap((event) =>
				event.type === "data" && event.value.type === "text"
					? [event.value.value]
					: [],
			);
		expect(texts).toEqual(["one", " more", "\n\ntwo"]);
	});

	it("skips results Tiny Chat already answered", () => {
		const reader = ClaudeCodeUtils.createReader();
		reader.answer("t1");
		expect(
			reader.read({
				type: "user",
				parent_tool_use_id: null,
				message: {
					content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }],
				},
			}),
		).toEqual([]);
	});

	it("reports a failed run as an abort", () => {
		const reader = ClaudeCodeUtils.createReader();
		const events = reader.read({
			type: "result",
			subtype: "error_during_execution",
			is_error: true,
			session_id: "s",
			errors: ["boom"],
		});
		expect(events[0]).toMatchObject({
			type: "data",
			value: { type: "abort", reason: "error", message: "boom" },
		});
		expect(events[1].type).toBe("end");
	});

	it("builds a subagent's conversation inside the call that started it", () => {
		const streamed: [string, unknown][] = [];
		const reader = ClaudeCodeUtils.createReader({
			onSubagent: (id, data) => streamed.push([id, data]),
		});
		reader.read({
			type: "assistant",
			parent_tool_use_id: null,
			message: {
				id: "m1",
				content: [{ type: "tool_use", id: "agent", name: "Agent", input: {} }],
			},
		});
		const nested = [
			{
				type: "assistant",
				parent_tool_use_id: "agent",
				message: { id: "s1", content: [{ type: "text", text: "Looking" }] },
			},
			{
				type: "assistant",
				parent_tool_use_id: "agent",
				message: {
					id: "s1",
					content: [
						{
							type: "tool_use",
							id: "read",
							name: "Read",
							input: { file_path: "/a" },
						},
					],
				},
			},
			{
				type: "user",
				parent_tool_use_id: "agent",
				message: {
					content: [
						{ type: "tool_result", tool_use_id: "read", content: "text" },
					],
				},
			},
		] as const;
		// None of it shows at the top level.
		for (const event of nested) expect(reader.read(event)).toEqual([]);

		const [id, data] = streamed.at(-1) ?? [];
		expect(id).toBe("agent");
		expect(data).toMatchObject([
			[
				{ type: "text", value: "Looking" },
				{ type: "toolCall", id: "read", name: "Read" },
				{ type: "toolResult", id: "read", output: [{ value: "text" }] },
			],
		]);
		// Its calls are known, so approving one shows it through the subagent.
		expect(reader.getCall("read")?.name).toBe("Read");
		expect(reader.refresh("read")).toBe("agent");
		expect(reader.refresh("agent")).toBeUndefined();
	});

	it("settles a background subagent's call once it ends", () => {
		const reader = ClaudeCodeUtils.createReader();
		reader.read({
			type: "assistant",
			parent_tool_use_id: null,
			message: {
				id: "m1",
				content: [{ type: "tool_use", id: "agent", name: "Agent", input: {} }],
			},
		});
		reader.read({
			type: "system",
			subtype: "task_started",
			task_id: "task",
			tool_use_id: "agent",
			is_backgrounded: true,
		});
		const [returned] = reader.read({
			type: "user",
			parent_tool_use_id: null,
			message: {
				content: [
					{ type: "tool_result", tool_use_id: "agent", content: "launched" },
				],
			},
		});
		expect(
			returned.type === "data" &&
				returned.value.type === "toolResult" &&
				ToolCallUtils.isBackground(returned.value.output),
		).toBe(true);

		reader.read({
			type: "assistant",
			parent_tool_use_id: "agent",
			message: { id: "s1", content: [{ type: "text", text: "beta" }] },
		});
		expect(
			reader.read({
				type: "system",
				subtype: "task_notification",
				task_id: "task",
				tool_use_id: "agent",
				status: "completed",
				summary: "done",
			}),
		).toMatchObject([
			{
				type: "data",
				value: {
					type: "interjection",
					task: { id: "agent", name: "Agent" },
					value: [{ type: "text", value: "beta" }],
				},
			},
		]);
	});

	it("reports structured output as JSON", () => {
		const reader = ClaudeCodeUtils.createReader();
		const events = reader.read({
			type: "result",
			subtype: "success",
			is_error: false,
			session_id: "s",
			structured_output: { answer: 42 },
		});
		expect(events[0]).toMatchObject({
			type: "data",
			value: { type: "json", value: { answer: 42 } },
		});
	});

	it("turns tool output into MCP content", () => {
		expect(
			ClaudeCodeUtils.toToolContent({
				id: "t",
				type: "toolResult",
				name: "x",
				output: [
					{ id: "1", type: "text", value: "a" },
					{ id: "2", type: "json", value: { b: 1 } },
					{ id: "3", type: "file", mime: "image/png", data: "AAA" },
					{ id: "4", type: "file", mime: "text/plain", data: btoa("hi") },
				],
			}),
		).toEqual([
			{ type: "text", text: "a" },
			{ type: "text", text: '{"b":1}' },
			{ type: "image", data: "AAA", mimeType: "image/png" },
			{ type: "text", text: "hi" },
		]);
	});

	it("reads the images and PDFs Claude Code's Read returns as files", () => {
		const parts = ClaudeCodeUtils.fromToolContent([
			{ type: "text", text: "PDF file read: /a/b.pdf (1KB)" },
			{
				type: "document",
				source: { type: "base64", media_type: "application/pdf", data: "JVBE" },
			},
			{
				type: "image",
				source: { type: "base64", data: "iVBO", media_type: "image/png" },
			},
		]);
		expect(parts.map(({ id: _, ...part }) => part)).toEqual([
			{ type: "text", value: "PDF file read: /a/b.pdf (1KB)" },
			{ type: "file", mime: "application/pdf", data: "JVBE" },
			{ type: "file", mime: "image/png", data: "iVBO" },
		]);
	});
});
