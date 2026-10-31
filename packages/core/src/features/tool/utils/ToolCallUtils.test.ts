import type { zToolResultPart } from "#core/features/data/types/part.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import { createQuestionsToolset } from "#core/features/tool/tools/questions.ts";
import { createShellToolset } from "#core/features/tool/tools/shell.ts";
import { createWebToolset } from "#core/features/tool/tools/web.ts";
import type { ToolStatusPart } from "#core/features/tool/types/display.ts";
import {
	type ToolCallStatus,
	ToolCallUtils,
} from "#core/features/tool/utils/ToolCallUtils.ts";

type ToolCallPart = Extract<RenderedPart, { type: "toolCall" }>;

const status = { valid: true };
const toolsets = [
	await createShellToolset({ capabilities: {}, status }),
	await createWebToolset({ capabilities: { web: {} as never }, status }),
	await createQuestionsToolset({ capabilities: undefined, status }),
];

let ids = 0;
const call = (
	name: string,
	input: unknown,
	extra: Partial<ToolCallPart> = {},
): ToolCallPart => ({
	type: "toolCall",
	id: `call-${ids++}`,
	name,
	input,
	...extra,
});

const result = (
	part: ToolCallPart,
	output: zToolResultPart["output"],
	error?: boolean,
): ToolCallPart => ({
	...part,
	result: { type: "toolResult", id: part.id, name: part.name, output, error },
});

const json = (value: unknown) => ({ id: "json", type: "json" as const, value });

const text = (parts: ToolStatusPart[]) =>
	parts.map((part) => part.text).join(" ");

const statusOf = (part: ToolCallPart): ToolCallStatus =>
	ToolCallUtils.getStatus({ part, toolsets });

describe("ToolCallUtils", () => {
	describe("status lines", () => {
		it("reads a single call with its subject", () => {
			const read = call("read_file", { path: "/src/a.txt" });
			expect(text(ToolCallUtils.resolveStatus(statusOf(read)))).toBe(
				"Reading file a.txt",
			);
			expect(
				text(
					ToolCallUtils.resolveStatus(
						statusOf(result(read, [json({ path: "/src/a.txt" })])),
					),
				),
			).toBe("Read file a.txt");
		});

		it("emphasizes subjects, counted or not", () => {
			const search = result(call("search_web", { query: "cats" }), []);
			expect(ToolCallUtils.resolveStatus(statusOf(search))).toEqual([
				{ text: "Searched web for" },
				{ text: "cats", subject: true },
			]);
		});

		it("combines sequential calls by what they count", () => {
			const done = (part: ToolCallPart) => result(part, []);
			const summary = ToolCallUtils.resolveSummary([
				statusOf(done(call("read_file", { path: "a.txt" }))),
				statusOf(done(call("read_file", { path: "b.txt" }))),
				statusOf(done(call("edit_file", { path: "a.txt" }))),
			]);
			expect(text(summary)).toBe("Read 2 files, edited 1 file");
			expect(summary.filter((part) => part.subject)).toEqual([
				{ text: "2 files,", subject: true },
				{ text: "1 file", subject: true },
			]);
		});

		it("keeps a kind in the present tense while any of it runs", () => {
			const summary = ToolCallUtils.resolveSummary([
				statusOf(result(call("read_file", { path: "a.txt" }), [])),
				statusOf(call("read_file", { path: "b.txt" })),
				statusOf(result(call("shell_exec", { command: "ls" }), [])),
			]);
			expect(text(summary)).toBe("Reading 2 files, ran 1 command");
		});

		it("counts a subject that stands in for its noun", () => {
			const summary = ToolCallUtils.resolveSummary([
				statusOf(result(call("search_web", { query: "cats" }), [])),
				statusOf(result(call("search_web", { query: "dogs" }), [])),
			]);
			expect(text(summary)).toBe("Searched web for 2 queries");
		});

		it("counts unknown tools as tools", () => {
			const summary = ToolCallUtils.resolveSummary([
				statusOf(result(call("mcp_one", {}), [])),
				statusOf(result(call("mcp_two", {}), [])),
			]);
			expect(text(summary)).toBe("Used 2 tools");
		});
	});

	describe("groups", () => {
		it("counts its calls and summarises them", () => {
			const read = result(call("read_file", { path: "a.txt" }), []);
			const group = ToolCallUtils.getGroup({ parts: [read], toolsets });
			expect(group.calls).toBe(1);
			expect(group.pending).toBe(false);
			expect(text(group.status)).toBe("Read file a.txt");
		});
	});

	describe("displays", () => {
		it("shows input as it streams in", () => {
			const display = ToolCallUtils.getDisplay({
				part: call(
					"write_file",
					{ path: "/a.ts", content: "const a" },
					{ partial: true },
				),
				toolsets,
			});
			expect(display.state).toBe("input");
			expect(display.active).toBe(true);
			expect(display.input).toEqual([
				{
					type: "file",
					path: "/a.ts",
					content: "const a",
					language: "typescript",
				},
			]);
			expect(display.output).toEqual([]);
		});

		it("streams output into the block its result settles in", () => {
			const part = call("shell_exec", { command: "ls", mnt: false });
			const running = ToolCallUtils.getDisplay({
				part,
				toolsets,
				stream: [
					{ type: "stdout", value: "a" },
					{ type: "stdout", value: "b" },
				],
			});
			expect(running.state).toBe("running");
			expect(running.output).toEqual([
				{ type: "code", value: "a\nb", terminal: true },
			]);

			const done = ToolCallUtils.getDisplay({
				part: result(part, [json({ code: 0, stdout: "a\nb\n", stderr: "" })]),
				toolsets,
			});
			expect(done.state).toBe("success");
			expect(done.active).toBe(false);
			expect(done.output).toEqual(running.output);
		});

		it("asks for feedback with the tool's fields", () => {
			const display = ToolCallUtils.getDisplay({
				part: call("ask_question", {
					questions: [
						{
							question: "Which?",
							header: "Pick",
							options: [{ label: "a", description: "first" }, { label: "b" }],
							multiSelect: true,
						},
					],
				}),
				toolsets,
			});
			expect(display.state).toBe("feedback");
			expect(display.input).toEqual([{ type: "markdown", value: "Which?" }]);
			expect(display.controls).toEqual({
				approval: false,
				fields: [
					{
						type: "choice",
						name: "q0",
						label: undefined,
						header: "Pick",
						options: [
							{ label: "a", description: "first" },
							{ label: "b", description: undefined },
						],
						multiple: true,
						custom: true,
						placeholder: "Something else…",
					},
				],
			});
		});

		it("heads each field with its question when there are several", () => {
			const display = ToolCallUtils.getDisplay({
				part: call("ask_question", {
					questions: [
						{ question: "One?", options: [] },
						{ question: "Two?", options: [] },
					],
				}),
				toolsets,
			});
			expect(display.input).toEqual([]);
			expect(display.controls?.fields.map((field) => field.label)).toEqual([
				"One?",
				"Two?",
			]);
		});

		it("still shows a call asked as one question with suggestions", () => {
			const display = ToolCallUtils.getDisplay({
				part: call("ask_question", { question: "Which?", suggestions: ["a"] }),
				toolsets,
			});
			expect(display.input).toEqual([{ type: "markdown", value: "Which?" }]);
			expect(display.controls?.fields[0].options).toEqual([
				{ label: "a", description: undefined },
			]);
		});

		it("asks for answers to Claude Code's own questions", () => {
			const display = ToolCallUtils.getDisplay({
				part: call("AskUserQuestion", {
					questions: [{ question: "Which?", header: "Pick", options: [] }],
				}),
				toolsets,
			});
			expect(display.state).toBe("feedback");
			expect(display.controls?.approval).toBe(false);
			expect(display.controls?.fields).toHaveLength(1);
		});

		it("asks for approval, and is running once it streams", () => {
			const part = call(
				"shell_exec",
				{ command: "rm a", mnt: false },
				{ validation: { approval: true } },
			);
			const waiting = ToolCallUtils.getDisplay({ part, toolsets });
			expect(waiting.state).toBe("feedback");
			expect(waiting.controls).toEqual({ approval: true, fields: [] });

			const running = ToolCallUtils.getDisplay({ part, toolsets, stream: [] });
			expect(running.state).toBe("running");
			expect(running.controls).toBeUndefined();
		});

		it("shows errors and rejections in place of output", () => {
			const failed = ToolCallUtils.getDisplay({
				part: result(
					call("read_file", { path: "a.txt" }),
					[{ id: "e", type: "text", value: "missing" }],
					true,
				),
				toolsets,
			});
			expect(failed.state).toBe("error");
			expect(failed.output).toEqual([
				{ type: "text", value: "missing", tone: "error" },
			]);

			const rejected = ToolCallUtils.getDisplay({
				part: result(
					call("shell_exec", { command: "rm a", mnt: false }),
					ToolCallUtils.getRejection(),
				),
				toolsets,
			});
			expect(rejected.state).toBe("rejected");
		});

		it("falls back to raw input and output for unknown tools", () => {
			const display = ToolCallUtils.getDisplay({
				part: result(call("mcp_lookup", { id: 1 }), [
					json({ found: true }),
					{ id: "t", type: "text", value: "raw" },
				]),
				toolsets,
			});
			expect(text(display.status)).toBe("Used mcp_lookup");
			expect(display.input).toEqual([
				{ type: "json", value: { id: 1 }, title: "Input" },
			]);
			expect(display.output).toEqual([
				{ type: "json", value: { found: true } },
				{ type: "code", value: "raw" },
			]);
		});
	});
});
