import type { CompletionItem } from "#client/features/editor/types/completion.ts";
import { CompletionUtils } from "#client/features/editor/utils/CompletionUtils.ts";

describe("CompletionUtils", () => {
	it("orders exact, prefix, and substring matches intuitively", () => {
		const items: CompletionItem[] = [
			{ value: "set-preset" },
			{ value: "unset-preset" },
			{ value: "preset" },
			{ value: "presets" },
		];

		expect(
			CompletionUtils.filter({ items, query: "preset" }).map(
				(item) => item.value,
			),
		).toEqual(["preset", "presets", "set-preset", "unset-preset"]);
	});

	it("ignores punctuation when matching completion names", () => {
		const items: CompletionItem[] = [{ value: "set-preset" }];

		expect(
			CompletionUtils.filter({ items, query: "setpres" }).map(
				(item) => item.value,
			),
		).toEqual(["set-preset"]);
	});

	it("preserves declaration order for equally weighted matches", () => {
		const items: CompletionItem[] = [
			{ value: "settings" },
			{ value: "set-preset" },
		];

		expect(
			CompletionUtils.filter({ items, query: "set" }).map((item) => item.value),
		).toEqual(["settings", "set-preset"]);
	});

	it("matches parts in any order across any separators", () => {
		const items: CompletionItem[] = [
			{ value: "gpt-6-astra" },
			{ value: "claude--opus" },
			{ value: "gemini" },
		];
		const find = (query: string) =>
			CompletionUtils.filter({ items, query }).map((item) => item.value);

		expect(find("astra6")).toEqual(["gpt-6-astra"]);
		expect(find("ptastra")).toEqual(["gpt-6-astra"]);
		expect(find("6 gpt")).toEqual(["gpt-6-astra"]);
		expect(find("opus-claude")).toEqual(["claude--opus"]);
	});

	it("forgives typos but not on very short queries", () => {
		const items: CompletionItem[] = [{ value: "gpt-6-astra" }];
		const find = (query: string) =>
			CompletionUtils.filter({ items, query }).map((item) => item.value);

		expect(find("atsra")).toEqual(["gpt-6-astra"]);
		expect(find("astar6")).toEqual(["gpt-6-astra"]);
		expect(find("gtpastra")).toEqual(["gpt-6-astra"]);
		expect(find("zq")).toEqual([]);
	});

	it("ranks direct matches above looser ones", () => {
		const items: CompletionItem[] = [
			{ value: "typo-astra" },
			{ value: "gpt-6-astra" },
			{ value: "astra" },
			{ value: "astral" },
		];

		expect(
			CompletionUtils.filter({ items, query: "astra" }).map(
				(item) => item.value,
			),
		).toEqual(["astra", "astral", "typo-astra", "gpt-6-astra"]);
	});
});

describe("CompletionUtils tabs", () => {
	const groups = [
		{ items: [{ value: "default" }] },
		{ name: "openai", items: [{ value: "a" }] },
		{ name: "empty", items: [] },
		{ name: "anthropic", items: [{ value: "b" }] },
	];

	it("offers every item, then each named group with items", () => {
		expect(CompletionUtils.tabs(groups)).toEqual([null, "openai", "anthropic"]);
		expect(CompletionUtils.tabs(groups.slice(0, 2))).toEqual([]);
	});

	it("steps around the tabs, from every item when one is gone", () => {
		const tabs = CompletionUtils.tabs(groups);
		expect(CompletionUtils.stepTab({ tabs, tab: null, direction: -1 })).toBe(
			"anthropic",
		);
		expect(
			CompletionUtils.stepTab({ tabs, tab: "anthropic", direction: 1 }),
		).toBe(null);
		expect(CompletionUtils.stepTab({ tabs, tab: "gone", direction: 1 })).toBe(
			"openai",
		);
	});

	it("shows a tab's own group, or all of them once it is gone", () => {
		expect(CompletionUtils.inTab({ groups, tab: "openai" })).toEqual([
			groups[1],
		]);
		expect(CompletionUtils.inTab({ groups, tab: "gone" })).toBe(groups);
	});
});
