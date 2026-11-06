import { ChapterUtils } from "#client/features/chapter/utils/ChapterUtils.ts";
import type { zData } from "#core/features/data/types/part.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";

const user = (id: string, text: string) => ({
	id,
	author: "USER" as const,
	data: [[{ id: `${id}:t`, type: "text", value: text }]] as zData,
});

const call = (id: string) => ({
	id,
	type: "toolCall" as const,
	name: "shell_exec",
	input: { command: "pnpm dev", background: true },
});

const reply = (id: string, data: zData) => ({
	id,
	author: "MODEL" as const,
	data,
});

describe("ChapterUtils", () => {
	it("marks only the user's messages, labeled by their cleaned text", () => {
		const chapters = ChapterUtils.getChapters({
			messages: [
				user("a", "Start the **dev** server"),
				reply("b", [[{ id: "t", type: "text", value: "Done." }]]),
				user("c", ""),
			],
			toolsets: [],
			live: new Set(),
		});
		expect(
			chapters.map(({ type, key, index, label }) => ({
				type,
				key,
				index,
				label,
			})),
		).toEqual([
			{ type: "message", key: "a", index: 0, label: "Start the dev server" },
			{ type: "message", key: "c", index: 2, label: "Message" },
		]);
	});

	it("labels a message by its prose, not its code or tables", () => {
		const [chapter] = ChapterUtils.getChapters({
			messages: [
				user(
					"a",
					"```ts\nconst a = 1;\n```\n| a | b |\n| - | - |\nThe **summary** follows.",
				),
			],
			toolsets: [],
			live: new Set(),
		});
		expect(chapter.label).toBe("The summary follows.");
	});

	it("marks a background call, after its message's, only while its stream is open", () => {
		const data: zData = [
			[
				call("dev"),
				{
					id: "dev",
					type: "toolResult",
					name: "shell_exec",
					output: ToolCallUtils.getBackground({ id: "dev" }),
				},
				{ id: "t", type: "text", value: "It's running." },
			],
		];
		const messages = [user("a", "go"), reply("b", data), user("c", "next")];

		expect(ChapterUtils.getCandidates(messages)).toEqual(["dev"]);

		const running = ChapterUtils.getChapters({
			messages,
			toolsets: [],
			live: new Set(["dev"]),
		});
		expect(running).toMatchObject([
			{ type: "message", messageId: "a" },
			{
				type: "toolCall",
				id: "dev",
				messageId: "b",
				index: 1,
				state: "running",
			},
			{ type: "message", messageId: "c" },
		]);

		// Cut off without ever settling, as when the app closed on it.
		const stale = ChapterUtils.getChapters({
			messages,
			toolsets: [],
			live: new Set(),
		});
		expect(stale.map((chapter) => chapter.type)).toEqual([
			"message",
			"message",
		]);
	});

	it("drops a call once it has finished", () => {
		const data: zData = [
			[
				call("dev"),
				{
					id: "dev",
					type: "toolResult",
					name: "shell_exec",
					output: [{ id: "o", type: "text", value: "done" }],
				},
			],
		];
		expect(ChapterUtils.getCandidates([reply("b", data)])).toEqual([]);
	});

	it("places marks where their content starts, kept apart", () => {
		expect(
			ChapterUtils.place({
				tops: [0, 500, 1000],
				content: 2000,
				track: 200,
				gap: 8,
			}),
		).toEqual([0, 50, 100]);

		// Crowded marks push down past each other, then back up off the end.
		expect(
			ChapterUtils.place({
				tops: [0, 1, 1990, 1995],
				content: 2000,
				track: 20,
				gap: 1,
				round: true,
			}),
		).toEqual([0, 1, 18, 19]);

		// More than fit are left where they would be.
		expect(
			ChapterUtils.place({
				tops: [0, 0, 0],
				content: 10,
				track: 2,
				gap: 1,
				round: true,
			}),
		).toEqual([0, 0, 0]);
	});

	it("lists marks evenly, centered, closer where they don't fit", () => {
		expect(ChapterUtils.stack({ count: 3, track: 100, gap: 10 })).toEqual([
			40, 50, 60,
		]);
		expect(ChapterUtils.stack({ count: 3, track: 10, gap: 10 })).toEqual([
			0, 5, 10,
		]);
		expect(ChapterUtils.stack({ count: 1, track: 10, gap: 10 })).toEqual([5]);
		expect(ChapterUtils.stack({ count: 0, track: 10, gap: 10 })).toEqual([]);
	});

	it("finds the chapter being read", () => {
		const tops = [0, 100, 300];
		expect(ChapterUtils.getCurrent({ tops, at: 0 })).toBe(0);
		expect(ChapterUtils.getCurrent({ tops, at: 150 })).toBe(1);
		expect(ChapterUtils.getCurrent({ tops, at: 1000 })).toBe(2);
		expect(ChapterUtils.getCurrent({ tops: [], at: 0 })).toBe(-1);
	});
});
