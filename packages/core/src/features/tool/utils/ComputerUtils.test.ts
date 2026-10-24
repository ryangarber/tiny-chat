import type { zComputerNode } from "#core/features/tool/types/computer.ts";
import { ComputerUtils } from "#core/features/tool/utils/ComputerUtils.ts";

const bounds = { x: 10, y: 20, width: 100, height: 40 };

// Shaped like gtk3-demo's tree as the host library reads it.
const nodes: zComputerNode[] = [
	{
		handle: 1,
		parent: null,
		role: "window",
		name: "Application Class",
		states: ["active"],
	},
	{ handle: 2, parent: 1, role: "group" },
	{
		handle: 3,
		parent: 2,
		role: "button",
		name: "Run",
		actions: ["press"],
		bounds,
	},
	{ handle: 4, parent: 2, role: "separator", states: ["hidden"] },
	{
		handle: 5,
		parent: 2,
		role: "static_text",
		name: "Application Class",
		value: "Application Class",
	},
	{ handle: 6, parent: 1, role: "table" },
	{
		handle: 7,
		parent: 6,
		role: "table_cell",
		name: "Benchmark",
		states: ["selected"],
	},
	{ handle: 8, parent: 6, role: "table_cell", name: "   " },
	{
		handle: 9,
		parent: 1,
		role: "text_field",
		name: "Search",
		value: "abc",
		states: ["editable", "focused"],
		actions: ["focus"],
	},
	{ handle: 10, parent: 4, role: "button", name: "Hidden inside" },
];

const refOf = (node: zComputerNode) => `e${node.handle}`;

describe("ComputerUtils.outline", () => {
	it("folds layout, drops hidden and empty nodes, and refs interactive ones", () => {
		expect(ComputerUtils.outline({ nodes, refOf })).toBe(
			[
				'- window "Application Class":',
				'  - button "Run" [ref=e3]',
				"  - text: Application Class",
				'  - table_cell "Benchmark" [selected] [ref=e7]',
				'  - text_field "Search" [focused] [ref=e9]: abc',
			].join("\n"),
		);
	});

	it("shows only matches and what contains them with find", () => {
		expect(ComputerUtils.outline({ nodes, refOf, find: "bench" })).toBe(
			[
				'- window "Application Class":',
				'  - table_cell "Benchmark" [selected] [ref=e7]',
			].join("\n"),
		);
		expect(ComputerUtils.outline({ nodes, refOf, find: "hidden inside" })).toBe(
			'Nothing matches "hidden inside".',
		);
	});

	it("truncates with a hint", () => {
		const outline = ComputerUtils.outline({ nodes, refOf, maxLength: 40 });
		expect(outline).toMatch(/^- window "Application Class":\n {2}- b/);
		expect(outline).toContain("more characters; read a narrower ref");
	});
});

describe("ComputerUtils.findAll", () => {
	it("skips hidden subtrees", () => {
		expect(
			ComputerUtils.findAll(nodes, "button").map((node) => node.handle),
		).toEqual([3]);
	});
});

describe("ComputerUtils.paths", () => {
	it("tells same-looking siblings apart", () => {
		const paths = ComputerUtils.paths([
			{ handle: 1, parent: null, role: "window", name: "W" },
			{ handle: 2, parent: 1, role: "button", name: "OK" },
			{ handle: 3, parent: 1, role: "button", name: "OK" },
		]);
		expect(paths.get(2)).toBe("/window:W#0/button:OK#0");
		expect(paths.get(3)).toBe("/window:W#0/button:OK#1");
	});

	it("places a subtree under its root's path", () => {
		const paths = ComputerUtils.paths(
			[
				{ handle: 5, parent: null, role: "group" },
				{ handle: 6, parent: 5, role: "button", name: "OK" },
			],
			"/window:W#0/group:#0",
		);
		expect(paths.get(5)).toBe("/window:W#0/group:#0");
		expect(paths.get(6)).toBe("/window:W#0/group:#0/button:OK#0");
	});
});

describe("ComputerUtils.parseKeys", () => {
	it("parses chords and sequences", () => {
		expect(ComputerUtils.parseKeys("Control+A Backspace A", "linux")).toEqual([
			{ key: "a", modifiers: ["ctrl"] },
			{ key: "backspace", modifiers: [] },
			{ key: "a", modifiers: ["shift"] },
		]);
		expect(ComputerUtils.parseKeys("Mod+s", "macos")).toEqual([
			{ key: "s", modifiers: ["meta"] },
		]);
		expect(ComputerUtils.parseKeys("Mod+s", "windows")).toEqual([
			{ key: "s", modifiers: ["ctrl"] },
		]);
		expect(ComputerUtils.parseKeys("Shift+Tab F5 Control++", "linux")).toEqual([
			{ key: "tab", modifiers: ["shift"] },
			{ key: "f5", modifiers: [] },
			{ key: "+", modifiers: ["ctrl"] },
		]);
	});

	it("rejects what is not a key", () => {
		expect(() => ComputerUtils.parseKeys("Hyper+x", "linux")).toThrow(
			"Unknown modifier",
		);
		expect(() => ComputerUtils.parseKeys("hello", "linux")).toThrow(
			"Use a type step",
		);
	});
});
