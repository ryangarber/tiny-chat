import { describe, expect, it } from "vitest";
import type { zData } from "#core/features/data/types/part.ts";
import { TranscriptUtils } from "#core/features/data/utils/TranscriptUtils.ts";

const at = Temporal.PlainDateTime.from("2026-10-24T09:30:00");
const message = (author: "USER" | "MODEL", data: zData) => ({
	author,
	createdAt: at,
	data,
});

describe("TranscriptUtils", () => {
	it("keeps what each side said and what the model did, without its thinking or tool output", () => {
		const transcript = TranscriptUtils.build({
			title: "Trip",
			messages: [
				message("USER", [
					[
						{ id: "1", type: "text", value: "Plan a trip" },
						{
							id: "2",
							type: "attachment",
							source: "web:example.com",
							label: "example.com",
							content: { type: "web", content: "page" },
						},
					],
				]),
				message("MODEL", [
					[
						{ id: "3", type: "thought", value: "hmm" },
						{
							id: "4",
							type: "toolCall",
							name: "search_web",
							input: { q: "x" },
						},
					],
					[
						{
							id: "4",
							type: "toolResult",
							name: "search_web",
							output: [{ id: "5", type: "text", value: "results" }],
						},
						{ id: "6", type: "text", value: "Here is a plan." },
					],
				]),
			],
		});

		expect(transcript).toBe(
			[
				"# Trip",
				"## User (2026-10-24 09:30 UTC)",
				"Plan a trip\n\n@example.com",
				"## Assistant (2026-10-24 09:30 UTC)",
				'[search_web {"q":"x"}]\n\nHere is a plan.',
			].join("\n\n"),
		);
	});

	it("keeps the opening message and the end of a chat past the budget", () => {
		const text = (value: string) => [
			[{ id: value, type: "text" as const, value }],
		];
		const transcript = TranscriptUtils.build({
			messages: ["first", "second", "third", "fourth"].map((value) =>
				message("USER", text(value.repeat(10))),
			),
			maxChars: 200,
		});

		expect(transcript).toContain("first");
		expect(transcript).toContain("(2 messages omitted for length)");
		expect(transcript).not.toContain("third");
		expect(transcript).toContain("fourth");
	});
});
