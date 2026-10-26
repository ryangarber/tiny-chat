import { FileMatchUtils } from "#core/features/file/utils/FileMatchUtils.ts";

describe("file search globs", () => {
	it.each([
		["*.ts", "src/deep/FILE.TS", true],
		["*.ts", "src/file.tsx", false],
		["src/*.ts", "src/file.ts", true],
		["src/*.ts", "src/deep/file.ts", false],
		["src/*.ts", "other/src/file.ts", false],
		["src/**/*.ts", "src/file.ts", true],
		["src/**/*.ts", "src/a/b/file.ts", true],
		["**/*.{ts,tsx}", "file.tsx", true],
		["**/*.{ts,tsx}", "src/file.js", false],
		["file?.[ch]", "src/file1.c", true],
		["file?.[!ch]", "src/file1.c", false],
		["file?.[!ch]", "src/file1.s", true],
		["*.ts", "src\\deep\\file.ts", true],
		["src/*.ts", "./src/file.ts", true],
		["report(1).txt", "report(1).txt", true],
		["report(1).txt", "report1.txt", false],
		["file[.txt", "file[.txt", true],
		["file{.txt", "file{.txt", true],
	])("%s matches %s: %s", (pattern, path, expected) => {
		expect(FileMatchUtils.matches({ pattern, path })).toBe(expected);
	});

	it("applies ignore rules in order, including re-inclusion and directory-only rules", () => {
		const rules = FileMatchUtils.getRules({
			content:
				"# comment\r\n\n*.log\r\n!keep.log\r\nprivate/\r\n/root.txt\r\nsrc/generated/*\r\n",
		});
		const ignored = (path: string, isDirectory = false) =>
			FileMatchUtils.isIgnored({ rules, path, isDirectory });
		expect(ignored("nested/debug.log")).toBe(true);
		expect(ignored("nested/keep.log")).toBe(false);
		expect(ignored("private", true)).toBe(true);
		expect(ignored("nested/private", true)).toBe(true);
		expect(ignored("private")).toBe(false);
		expect(ignored("root.txt")).toBe(true);
		expect(ignored("nested/root.txt")).toBe(false);
		expect(ignored("src/generated/a.ts")).toBe(true);
		expect(ignored("nested/src/generated/a.ts")).toBe(false);
	});

	it("a later exclusion overrides a previous negation and rules remain case-sensitive", () => {
		const rules = FileMatchUtils.getRules({
			content: "*.log\n!keep.log\nkeep.*",
		});
		expect(
			FileMatchUtils.isIgnored({ rules, path: "keep.log", isDirectory: false }),
		).toBe(true);
		expect(
			FileMatchUtils.isIgnored({
				rules,
				path: "DEBUG.LOG",
				isDirectory: false,
			}),
		).toBe(false);
	});
});
