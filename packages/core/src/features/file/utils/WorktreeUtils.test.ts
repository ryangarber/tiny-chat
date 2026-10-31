import { describe, expect, it } from "vitest";
import { WorktreeUtils } from "#core/features/file/utils/WorktreeUtils.ts";

describe("WorktreeUtils", () => {
	it("finds a linked worktree's main checkout", () => {
		expect(WorktreeUtils.parse("/repo/.git\n/trees/feature\n")).toEqual({
			worktree: "/trees/feature",
			main: "/repo",
		});
		expect(WorktreeUtils.parse("C:/repo/.git\r\nC:/trees/feature\r\n")).toEqual(
			{ worktree: "C:/trees/feature", main: "C:/repo" },
		);
	});

	it("finds none in a main checkout, a bare repository or a submodule", () => {
		expect(WorktreeUtils.parse("/repo/.git\n/repo\n")).toBeNull();
		expect(WorktreeUtils.parse("/repo.git\n")).toBeNull();
		expect(
			WorktreeUtils.parse("/repo/.git/modules/lib\n/repo/lib\n"),
		).toBeNull();
	});

	it("maps a path in a worktree to the same place in the main checkout", () => {
		const tree = { worktree: "/trees/feature", main: "/repo" };
		expect(WorktreeUtils.toMain({ ...tree, path: "/trees/feature" })).toBe(
			"/repo",
		);
		expect(WorktreeUtils.toMain({ ...tree, path: "/trees/feature/src/" })).toBe(
			"/repo/src",
		);
		expect(WorktreeUtils.toMain({ ...tree, path: "/trees/featured" })).toBe(
			null,
		);
	});
});
