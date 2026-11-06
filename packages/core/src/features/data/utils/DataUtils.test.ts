import { describe, expect, it } from "vitest";
import type { zData } from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";

describe("DataUtils", () => {
	describe("getCheckpoint", () => {
		it("ends a copy on a checkpoint, settling running calls but not awaited ones", () => {
			const data: zData = [
				[
					{ id: "t", type: "text", value: "Working" },
					{ id: "done", type: "toolCall", name: "read", input: {} },
					{
						id: "done",
						type: "toolResult",
						name: "read",
						output: [{ id: "o", type: "text", value: "ok" }],
					},
					{ id: "running", type: "toolCall", name: "bash", input: {} },
					{ id: "asking", type: "toolCall", name: "ask", input: {} },
					{
						id: "half",
						type: "toolCall",
						name: "write",
						input: {},
						partial: true,
					},
				],
			];
			const checkpoint = DataUtils.getCheckpoint({
				data,
				awaiting: (id) => id === "asking",
			});

			const parts = checkpoint[0];
			expect(parts.map((part) => `${part.type}:${part.id}`)).toEqual([
				"text:t",
				"toolCall:done",
				"toolResult:done",
				"toolCall:running",
				"toolCall:asking",
				"toolResult:running",
				`abort:${parts.at(-1)?.id}`,
			]);
			expect(parts.at(-2)).toMatchObject({ error: true });
			expect(parts.at(-1)).toMatchObject({
				type: "abort",
				reason: "checkpoint",
			});
			// The generation goes on with the original untouched.
			expect(data[0]).toHaveLength(6);
		});

		it("checkpoints a reply with nothing in it yet", () => {
			const [[part]] = DataUtils.getCheckpoint({ data: [] });
			expect(DataUtils.isCheckpoint(part)).toBe(true);
		});
	});

	describe("getRenderedPartsGrouped", () => {
		it("breaks a run of tool calls at every thought", () => {
			const call = (id: string) =>
				({ type: "toolCall", id, name: "read_file", input: {} }) as const;
			const thought = (id: string) =>
				({ type: "thought", id, value: id }) as const;
			const data: zData = [
				[thought("t1"), thought("t2"), call("c1"), call("c2")],
				[thought("t3"), call("c3"), { type: "text", id: "x", value: "done" }],
			];

			const parts = DataUtils.getRenderedPartsGrouped(
				data,
				false,
				"thought",
				"toolCall",
			);
			expect(
				parts.map((part) =>
					part.type === "group"
						? `${part.of}:${part.value.map((item) => item.id).join(",")}`
						: part.type,
				),
			).toEqual([
				"thought:t1,t2",
				"toolCall:c1,c2",
				"thought:t3",
				"toolCall:c3",
				"text",
			]);
		});
	});

	describe("getRenderedParts", () => {
		it("shows a background call with the result it finished with", () => {
			const data: zData = [
				[
					{ type: "toolCall", id: "a", name: "shell_exec", input: {} },
					{
						type: "toolResult",
						id: "a",
						name: "shell_exec",
						output: [{ id: "x", type: "text", value: "[Running…]" }],
					},
					{
						type: "interjection",
						id: "report",
						value: [{ id: "y", type: "json", value: { code: 0 } }],
						task: { id: "a", name: "shell_exec" },
					},
				],
			];
			const parts = DataUtils.getRenderedParts(data);
			expect(parts).toHaveLength(1);
			expect(parts[0]).toMatchObject({
				type: "toolCall",
				result: {
					type: "toolResult",
					id: "a",
					output: [{ type: "json", value: { code: 0 } }],
				},
			});
		});

		it("tells apart thoughts a provider numbered afresh in each step", () => {
			const data: zData = [
				[{ type: "thought", id: "0", value: "first" }],
				[
					{ type: "thought", id: "0", value: "second" },
					{ type: "thought", id: "1", value: "third" },
				],
				[{ type: "thought", id: "0", value: "fourth" }],
			];
			const ids = DataUtils.getRenderedParts(data).map((part) => part.id);
			expect(ids).toEqual(["0", "0@1", "1", "0@2"]);
		});
	});
});
