import { DiffUtils } from "#core/features/file/utils/DiffUtils.ts";

describe("DiffUtils", () => {
	it.each([
		["", "first\nsecond\n"],
		["first\nsecond\n", ""],
		["same\nold value\nend\n", "same\nnew value\nextra\nend\n"],
		["one\ntwo\nthree\n", "different\n"],
		["unchanged\n", "unchanged\n"],
		["return result.text", "return result.json()"],
		["hello world", "hello brave world"],
		["hello brave world", "hello world"],
	])("preserves both sides of a diff: %j -> %j", (before, after) => {
		const diff = DiffUtils.diff({ before, after });
		const oldLines = diff.flatMap((line) =>
			line.type === "added"
				? []
				: [line.type === "changed" ? line.lineBefore : line.line],
		);
		const newLines = diff.flatMap((line) =>
			line.type === "removed"
				? []
				: [line.type === "changed" ? line.lineAfter : line.line],
		);
		expect(oldLines).toEqual(DiffUtils.split(before));
		expect(newLines).toEqual(DiffUtils.split(after));
		for (const line of diff) {
			if (line.type !== "changed") continue;
			expect(
				line.parts
					.map((p) =>
						p.type === "changed"
							? p.partBefore
							: p.type === "added"
								? ""
								: p.part,
					)
					.join(""),
			).toBe(line.lineBefore);
			expect(
				line.parts
					.map((p) =>
						p.type === "changed"
							? p.partAfter
							: p.type === "removed"
								? ""
								: p.part,
					)
					.join(""),
			).toBe(line.lineAfter);
		}
	});

	it.each([0, 1, 2, 3, 10])(
		"folds context without losing or duplicating searchable lines (%i)",
		(contextLines) => {
			const before = "a\nb\nc\nold first\nd\ne\nf\ng\nh\nold second\ni\nj\nk\n";
			const after = before
				.replace("old first", "new first")
				.replace("old second", "new second");
			const diff = DiffUtils.diff({ before, after });
			const expected = diff.flatMap((line) =>
				line.type === "changed"
					? [line.lineBefore, line.lineAfter]
					: [line.line],
			);
			expect(
				DiffUtils.lines(DiffUtils.context(diff, { contextLines })),
			).toEqual(expected);
		},
	);

	it("folds only lines outside the requested context", () => {
		const result = DiffUtils.context(
			[
				{ type: "unchanged", line: "a" },
				{ type: "unchanged", line: "b" },
				{ type: "added", line: "new" },
				{ type: "unchanged", line: "c" },
				{ type: "unchanged", line: "d" },
			],
			{ contextLines: 1 },
		);
		expect(result).toEqual([
			{ type: "unchanged", lines: ["a"] },
			{ type: "context", line: "b" },
			{ type: "added", line: "new" },
			{ type: "context", line: "c" },
			{ type: "unchanged", lines: ["d"] },
		]);
	});

	it("retains blank lines and a final line without a newline", () => {
		expect(DiffUtils.split("\nhello\n\n")).toEqual(["", "hello", ""]);
		expect(DiffUtils.split("hello")).toEqual(["hello"]);
		expect(DiffUtils.context([])).toEqual([]);
	});
});
