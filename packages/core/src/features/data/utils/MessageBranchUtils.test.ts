import { MessageBranchUtils } from "#core/features/data/utils/MessageBranchUtils.ts";

const m = (id: string, previousId: string | null, time = 0) => ({
	id,
	previousId,
	createdAt: new Date(time),
});
const tree = [
	m("r", null, 0),
	m("a", "r", 1),
	m("b", "r", 2),
	m("a0", "a", 3),
	m("b0", "b", 4),
	m("other", null, 5),
	m("a1", "a", 6),
];
const ids = (rows: typeof tree) => rows.map((m) => m.id);
describe("MessageBranchUtils", () => {
	it("defaults every fork to the branch holding the latest message, independently of query order", () => {
		expect(ids(MessageBranchUtils.getBranch([...tree].reverse()))).toEqual([
			"r",
			"a",
			"a1",
		]);
	});
	it("defaults to the newest of branches that are equally recent", () => {
		expect(
			ids(MessageBranchUtils.getBranch([m("x", null), m("y", null)])),
		).toEqual(["y"]);
	});
	it("selects roots and nested branches, falling back for deleted selections", () => {
		expect(
			ids(MessageBranchUtils.getBranch(tree, undefined, { r: "b" })),
		).toEqual(["r", "b", "b0"]);
		expect(
			ids(MessageBranchUtils.getBranch(tree, undefined, { a: "a0" })),
		).toEqual(["r", "a", "a0"]);
		expect(
			ids(MessageBranchUtils.getBranch(tree, undefined, { "": "other" })),
		).toEqual(["other"]);
		expect(
			ids(MessageBranchUtils.getBranch(tree, undefined, { r: "deleted" })),
		).toEqual(["r", "a", "a1"]);
	});
	it("reconstructs the ancestors of any anchor then defaults its continuation", () => {
		expect(ids(MessageBranchUtils.getBranch(tree, "a"))).toEqual([
			"r",
			"a",
			"a1",
		]);
		expect(ids(MessageBranchUtils.getBranch(tree, "b"))).toEqual([
			"r",
			"b",
			"b0",
		]);
		expect(ids(MessageBranchUtils.getBranch(tree, "a1"))).toEqual([
			"r",
			"a",
			"a1",
		]);
	});
	it("finds the full subtree without sibling branches", () => {
		expect(ids(MessageBranchUtils.getDescendants(tree, "a"))).toEqual([
			"a0",
			"a1",
		]);
	});
	it("handles empty chats and rejects missing anchors and cycles", () => {
		expect(MessageBranchUtils.getBranch([])).toEqual([]);
		expect(() => MessageBranchUtils.getBranch(tree, "missing")).toThrow();
		expect(() =>
			MessageBranchUtils.getBranch([m("x", "y"), m("y", "x")], "x"),
		).toThrow("cycle");
	});
});
