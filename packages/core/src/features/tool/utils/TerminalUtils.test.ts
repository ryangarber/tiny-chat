import { describe, expect, it } from "vitest";
import { TerminalUtils } from "#core/features/tool/utils/TerminalUtils.ts";

const screen = TerminalUtils.parse(
	[
		"\x1b[1m\x1b[38;2;255;0;0mRed\x1b[0m \x1b[48;5;33mBlue bg\x1b[49m 漢字x [OK]",
		"\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\ \x1b[7mpicked\x1b[27m \x1b[92mgo\x1b[39m",
		"",
	].join("\n"),
);

describe("TerminalUtils", () => {
	it("reads styles and keeps wide characters in their columns", () => {
		expect(TerminalUtils.text(screen[0])).toBe("Red Blue bg 漢字x [OK]");
		expect(screen[0][0]).toMatchObject({
			char: "R",
			fg: "#ff0000",
			bold: true,
		});
		expect(screen[0][4]).toMatchObject({ char: "B", bg: "#0087ff" });
		expect(TerminalUtils.find(screen, { text: "x" })).toEqual([
			{ row: 1, col: 17, width: 1, text: "x" },
		]);
		expect(TerminalUtils.text(screen[1])).toBe("link picked go");
	});

	it("matches text by style and place", () => {
		expect(TerminalUtils.find(screen, { text: "Red", fg: "Red" })).toEqual([]);
		expect(
			TerminalUtils.find(screen, { text: "Red", fg: "#F00", bold: true }),
		).toHaveLength(1);
		expect(
			TerminalUtils.find(screen, { text: "Blue bg", bg: "#0087ff" }),
		).toHaveLength(1);
		expect(TerminalUtils.find(screen, { regex: "\\[\\w+\\]", row: 1 })).toEqual(
			[{ row: 1, col: 19, width: 4, text: "[OK]" }],
		);
		expect(TerminalUtils.find(screen, { text: "go", col: 1 })).toEqual([]);
		expect(
			TerminalUtils.find(screen, { text: "go", fg: "bright green" }),
		).toHaveLength(1);
	});

	it("finds cells and styled runs without text", () => {
		expect(
			TerminalUtils.find(screen, { row: 2, col: 6, inverse: true }),
		).toEqual([{ row: 2, col: 6, width: 1, text: "p" }]);
		expect(TerminalUtils.find(screen, { inverse: true })).toEqual([
			{ row: 2, col: 6, width: 6, text: "picked" },
		]);
	});

	it("lists styled runs", () => {
		expect(TerminalUtils.styles(screen)).toEqual([
			{ row: 1, col: 1, text: "Red", fg: "#ff0000", bold: true },
			{ row: 1, col: 5, text: "Blue bg", bg: "#0087ff" },
			{ row: 2, col: 6, text: "picked", inverse: true },
			{ row: 2, col: 13, text: "go", fg: "brightgreen" },
		]);
	});

	it("names keys as tmux does", () => {
		expect(TerminalUtils.key("Enter")).toBe("Enter");
		expect(TerminalUtils.key("Alt+Enter")).toBe("M-Enter");
		expect(TerminalUtils.key("Control+c")).toBe("C-c");
		expect(TerminalUtils.key("Shift+Tab")).toBe("BTab");
		expect(TerminalUtils.key("Shift+a")).toBe("A");
		expect(TerminalUtils.key("Ctrl+Shift+Up")).toBe("C-S-Up");
		expect(TerminalUtils.key("Backspace")).toBe("BSpace");
		expect(TerminalUtils.key("f5")).toBe("F5");
		expect(TerminalUtils.key("M-Enter")).toBe("M-Enter");
		expect(TerminalUtils.key("Control++")).toBe("C-+");
		expect(TerminalUtils.key(";")).toBe("\\;");
		expect(() => TerminalUtils.key("Hyper+x")).toThrow(/modifier/);
	});

	it("encodes mouse events as the program asked", () => {
		const text = (bytes: number[]) => String.fromCharCode(...bytes);
		expect(
			text(TerminalUtils.mouse({ sgr: true, button: 0, col: 5, row: 2 })),
		).toBe("\x1b[<0;5;2M");
		expect(
			text(
				TerminalUtils.mouse({
					sgr: true,
					button: 0,
					col: 5,
					row: 2,
					release: true,
					modifiers: ["Control"],
				}),
			),
		).toBe("\x1b[<16;5;2m");
		expect(
			TerminalUtils.mouse({
				sgr: false,
				button: 2,
				col: 1,
				row: 1,
				release: true,
			}),
		).toEqual([0x1b, 0x5b, 0x4d, 32 + 3, 33, 33]);
	});
});
