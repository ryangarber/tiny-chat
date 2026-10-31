import type { CodeResult } from "#core/core/utils/CodeUtils.ts";
import {
	type MarkdownHighlight,
	MarkdownUtils,
} from "#tui/features/editor/utils/MarkdownUtils.ts";
import type { TextareaPaint } from "#tui/features/textarea/utils/TextareaUtils.ts";
import { TextareaUtils } from "#tui/features/textarea/utils/TextareaUtils.ts";

/** What every character ends up painted under, the way the text area paints it. */
const paint = (value: string, highlight?: MarkdownHighlight) =>
	TextareaUtils.paint(value, MarkdownUtils.labels({ highlight }));

/** Whether a character was painted under a label, alone or joined to others. */
const has = (paint: TextareaPaint | undefined, label: string) =>
	!!paint && paint.label.split("+").includes(label);

/** The text painted under a label, as one string per run of it. */
const claimed = (value: string, label: string) => {
	const painted = paint(value);
	const runs: string[] = [];

	for (let index = 0; index < value.length; index++) {
		if (!has(painted[index], label)) continue;
		if (index > 0 && has(painted[index - 1], label))
			runs[runs.length - 1] += value[index];
		else runs.push(value[index]);
	}

	return runs;
};

describe("MarkdownUtils.labels", () => {
	it("styles a span and the markers holding it apart", () => {
		expect(claimed("a **bold** b", "markdownBold")).toEqual(["**bold**"]);
		expect(claimed("a **bold** b", "markdownBoldMarker")).toEqual(["**", "**"]);

		expect(claimed("a *slanted* b", "markdownItalic")).toEqual(["*slanted*"]);
		expect(claimed("a *slanted* b", "markdownItalicMarker")).toEqual([
			"*",
			"*",
		]);

		expect(claimed("a _slanted_ b", "markdownItalic")).toEqual(["_slanted_"]);
		expect(claimed("a ~~gone~~ b", "markdownStrike")).toEqual(["~~gone~~"]);
		expect(claimed("a `read()` b", "markdownInlineCode")).toEqual(["`read()`"]);
		expect(claimed("a `read()` b", "markdownInlineCodeMarker")).toEqual([
			"`",
			"`",
		]);
	});

	it("paints exactly what a sent message would", () => {
		// A list item, not emphasis, at the start of a line…
		expect(claimed("* abcdef *", "markdownBullet")).toEqual(["*"]);
		expect(claimed("* abcdef *", "markdownItalic")).toEqual([]);
		// …and plain text in the middle of one.
		expect(claimed("a * abcdef * b", "markdownItalic")).toEqual([]);

		expect(claimed("2 * 3 * 4", "markdownItalic")).toEqual([]);
		expect(claimed("a ** b", "markdownBoldMarker")).toEqual([]);
		expect(claimed("snake_case_name", "markdownItalic")).toEqual([]);
		expect(claimed("a * b\nc * d", "markdownItalicMarker")).toEqual([]);

		// A single tilde strikes through, as GFM has it.
		expect(claimed("a ~gone~ b", "markdownStrike")).toEqual(["~gone~"]);
		// Emphasis may run across lines.
		expect(claimed("*one\ntwo*", "markdownItalic")).toEqual(["*one\ntwo*"]);
	});

	it("draws a span inside another in both of their styles", () => {
		const value = "**a *b* c**";
		const painted = paint(value);

		expect(claimed(value, "markdownItalic")).toEqual(["*b*"]);
		expect(has(painted[value.indexOf("b")], "markdownBold")).toBe(true);
		expect(has(painted[value.indexOf("b")], "markdownItalic")).toBe(true);
	});

	it("claims a fenced block whole, markdown inside it and all", () => {
		const value = "```ts\nconst a = **b**;\n```";

		expect(claimed(value, "markdownCodeFence")).toEqual(["```ts", "```"]);
		expect(claimed(value, "markdownCode")).toEqual([value]);
		expect(claimed(value, "markdownBold")).toEqual([]);
	});

	it("claims a fence that is still open through to the end", () => {
		expect(claimed("```\nstill **writing**", "markdownBold")).toEqual([]);
	});

	it("draws a block of code in the colours of its highlight", () => {
		const value = "say\n```ts\nlet a\n```";
		const result: CodeResult = {
			bg: "#101010",
			fg: "#eeeeee",
			tokens: [
				[
					{ content: "let", offset: 0, color: "#ff0000" },
					{ content: " a", offset: 3, color: "#00ff00" },
				],
			],
		};

		const painted = paint(value, (block) => {
			expect(block).toEqual({ start: 10, code: "let a", language: "ts" });
			return result;
		});

		expect(painted[value.indexOf("let")].style).toEqual({
			color: "#ff0000",
			bgColor: "#101010",
		});
		expect(painted[value.indexOf(" a")].style?.color).toBe("#00ff00");
		// The fences sit on the theme's background along with the code.
		expect(painted[value.indexOf("```")].style).toEqual({ bgColor: "#101010" });
		expect(painted[0].style).toBeUndefined();
	});

	it("keeps the last highlight in place while the code has moved on", () => {
		// Highlighted as "let a" on one line, and since edited on both.
		const value = "```ts\nlet abc\nx\n```";
		const stale: CodeResult = {
			bg: "#101010",
			fg: "#eeeeee",
			tokens: [
				[
					{ content: "let", offset: 0, color: "#ff0000" },
					{ content: " a", offset: 3, color: "#00ff00" },
				],
			],
		};

		const painted = paint(value, () => stale);
		const at = (text: string) => painted[value.indexOf(text)].style;

		expect(at("let")?.color).toBe("#ff0000");
		expect(at(" a")?.color).toBe("#00ff00");
		// Past what was highlighted, and on a line it never had, only the
		// background is laid down.
		expect(at("bc")).toEqual({ bgColor: "#101010" });
		expect(at("x\n")).toEqual({ bgColor: "#101010" });
	});

	it("finds the blocks of code to highlight", () => {
		expect(
			MarkdownUtils.codeBlocks("```py\nprint()\n```\n\n```\nopen"),
		).toEqual([
			{ start: 6, code: "print()", language: "py" },
			{ start: 23, code: "open", language: null },
		]);
	});

	it("styles the lines a construct takes whole", () => {
		expect(claimed("## Title", "markdownHeadingMarker")).toEqual(["##"]);
		expect(claimed("## Title", "markdownHeading")).toEqual(["## Title"]);
		expect(claimed("Title\n===", "markdownHeadingMarker")).toEqual(["==="]);

		expect(claimed("> said", "markdownQuoteMarker")).toEqual(["> "]);
		expect(claimed("> said", "markdownQuote")).toEqual(["> said"]);

		expect(claimed("- one\n- two", "markdownBullet")).toEqual(["-", "-"]);
		expect(claimed("1. one\n2. two", "markdownBullet")).toEqual(["1.", "2."]);
		expect(claimed("- [x] done", "markdownTask")).toEqual(["[x]"]);
		expect(claimed("---", "markdownRule")).toEqual(["---"]);
	});

	it("ends a quote where a sent message would", () => {
		// The line after a quote is opened apart from it before it is parsed,
		// rather than carried on as part of it.
		expect(claimed("> said\nafter", "markdownQuote")).toEqual(["> said"]);
	});

	it("leaves the markup inside a quote its own style", () => {
		expect(claimed("> a **bold** word", "markdownBold")).toEqual(["**bold**"]);
	});

	it("styles a link and its target apart", () => {
		const value = "see [docs](https://x.dev) now";

		expect(claimed(value, "markdownLinkText")).toEqual(["[docs]"]);
		expect(claimed(value, "markdownLinkUrl")).toEqual(["(https://x.dev)"]);
		expect(claimed("at https://x.dev", "markdownLinkText")).toEqual([
			"https://x.dev",
		]);
	});

	it("draws every label it paints under", () => {
		const styles = MarkdownUtils.styles({
			surface: "#000",
			interior: "#111",
			exterior: "#222",
			border: "#333",
			borderSubtle: "#444",
			text: "#fff",
			textSubtle: "#aaa",
			primary: "#1194ff",
		});

		const value = [
			"# a",
			"> b",
			"- [ ] c *d* **e** ~~f~~ `g` [h](i)",
			"---",
			"```",
			"j",
			"```",
		].join("\n");

		for (const { label } of paint(value)) {
			for (const part of label.split("+")) {
				if (part !== "text") expect(styles[part], part).toBeDefined();
			}
		}
	});
});

describe("MarkdownUtils.marked", () => {
	/** The content with the cursor drawn into it, which reads as the editor does. */
	const mark = (drawn: string, marker: string) => {
		const offset = drawn.indexOf("|");
		const value = drawn.replace("|", "");
		const write = MarkdownUtils.marked({ value, offset, marker });
		if (!write) return null;

		return `${write.content.slice(0, write.offset)}|${write.content.slice(write.offset)}`;
	};

	it("closes a span as it is opened", () => {
		expect(mark("|", "*")).toBe("*|*");
		expect(mark("a |", "`")).toBe("a `|`");
		expect(mark("a |", "~")).toBe("a ~|~");
	});

	it("turns a second marker at the opening into a wider one", () => {
		expect(mark("*|*", "*")).toBe("**|**");
		expect(mark("`|`", "`")).toBe("``|``");
		expect(mark("~|~", "~")).toBe("~~|~~");
	});

	it("steps over the marker already closing the span", () => {
		expect(mark("*slanted|*", "*")).toBe("*slanted*|");
		expect(mark("**bold|**", "*")).toBe("**bold*|*");
		expect(mark("**bold*|*", "*")).toBe("**bold**|");
	});

	it("leaves a word being marked up from its left to be written as typed", () => {
		expect(mark("|word", "*")).toBe(null);
	});

	it("leaves anything that is not a marker to be written as typed", () => {
		expect(mark("a|", "b")).toBe(null);
		expect(mark("a|", "-")).toBe(null);
	});
});

describe("MarkdownUtils.broken", () => {
	/** The content with the cursor drawn into it, as above. */
	const open = (drawn: string) => {
		const offset = drawn.indexOf("|");
		const value = drawn.replace("|", "");
		const write = MarkdownUtils.broken({ value, offset });
		if (!write) return null;

		return `${write.content.slice(0, write.offset)}|${write.content.slice(write.offset)}`;
	};

	it("carries a list on, numbering it as it goes", () => {
		expect(open("- one|")).toBe("- one\n- |");
		expect(open("* one|")).toBe("* one\n* |");
		expect(open("  - one|")).toBe("  - one\n  - |");
		expect(open("1. one|")).toBe("1. one\n2. |");
		expect(open("3) one|")).toBe("3) one\n4) |");
	});

	it("carries a task on as one still to do", () => {
		expect(open("- [x] done|")).toBe("- [x] done\n- [ ] |");
	});

	it("carries a quote on", () => {
		expect(open("> said|")).toBe("> said\n> |");
		expect(open("> - said|")).toBe("> - said\n> - |");
	});

	it("ends a block that nothing was written into", () => {
		expect(open("- one\n- |")).toBe("- one\n|");
		expect(open("> |")).toBe("|");
	});

	it("breaks a fence open around the cursor", () => {
		expect(open("```ts|```")).toBe("```ts\n|\n```");
		expect(open("```|```")).toBe("```\n|\n```");
	});

	it("leaves a plain line to be written as typed", () => {
		expect(open("a plain line|")).toBe(null);
		expect(open("|")).toBe(null);
	});
});

/**
 * The content with its selection drawn into it as `[` and `]`, or its cursor
 * as `|`.
 */
const drawn = (text: string) => {
	const cursor = text.indexOf("|");
	if (cursor !== -1)
		return {
			value: text.replace("|", ""),
			selection: [cursor, cursor] as [number, number],
		};

	const start = text.indexOf("[");
	const end = text.indexOf("]") - 1;
	return {
		value: text.replace("[", "").replace("]", ""),
		selection: [start, end] as [number, number],
	};
};

const draw = (edit: { value: string; selection: [number, number] } | null) => {
	if (!edit) return null;

	const [start, end] = edit.selection;
	if (start === end)
		return `${edit.value.slice(0, start)}|${edit.value.slice(start)}`;

	return `${edit.value.slice(0, start)}[${edit.value.slice(start, end)}]${edit.value.slice(end)}`;
};

describe("MarkdownUtils.indented", () => {
	const indent = (text: string) =>
		draw(MarkdownUtils.indented({ ...drawn(text), direction: 1 }));
	const unindent = (text: string) =>
		draw(MarkdownUtils.indented({ ...drawn(text), direction: -1 }));

	it("nests a list item under the one above it", () => {
		expect(indent("- one\n- tw|o")).toBe("- one\n  - tw|o");
		expect(indent("1. one\n2. tw|o")).toBe("1. one\n   1. tw|o");
		expect(indent("- one\n  - two\n- thr|ee")).toBe(
			"- one\n  - two\n  - thr|ee",
		);
		expect(indent("1. one\n   1. two\n2. thr|ee")).toBe(
			"1. one\n   1. two\n   2. thr|ee",
		);
	});

	it("takes the items nested under an item along with it", () => {
		expect(indent("- one\n- tw|o\n  - three\n- four")).toBe(
			"- one\n  - tw|o\n    - three\n- four",
		);
	});

	it("leaves the first item of a list where it is", () => {
		expect(indent("- on|e")).toBe(null);
		expect(indent("plain| text")).toBe(null);
	});

	it("lifts a list item out from under the one it is nested in", () => {
		expect(unindent("- one\n  - tw|o")).toBe("- one\n- tw|o");
		expect(unindent("1. one\n   1. tw|o")).toBe("1. one\n2. tw|o");
		expect(unindent("- tw|o")).toBe("tw|o");
	});

	it("indents code at the cursor, and every line selected", () => {
		expect(indent("```\nfoo|\n```")).toBe("```\nfoo  |\n```");
		expect(indent("```\n[foo\nbar]\n```")).toBe("```\n  [foo\n  bar]\n```");
		expect(unindent("```\n    fo|o\n```")).toBe("```\n  fo|o\n```");
		expect(unindent("```\nfo|o\n```")).toBe(null);
	});

	it("leaves the fence of a block of code be", () => {
		expect(indent("```|\nfoo\n```")).toBe(null);
	});
});

describe("MarkdownUtils.toggled", () => {
	const bold = (text: string) =>
		draw(MarkdownUtils.toggled({ ...drawn(text), size: 2 }));
	const italic = (text: string) =>
		draw(MarkdownUtils.toggled({ ...drawn(text), size: 1 }));

	it("wraps a selection, and unwraps it again", () => {
		expect(bold("a [word] b")).toBe("a **[word]** b");
		expect(bold("a **[word]** b")).toBe("a [word] b");
		expect(bold("a [**word**] b")).toBe("a [word] b");
		expect(italic("a [word] b")).toBe("a *[word]* b");
		expect(italic("a *[word]* b")).toBe("a [word] b");
	});

	it("tells a bold from an italic", () => {
		expect(italic("a **[word]** b")).toBe("a ***[word]*** b");
		expect(italic("a ***[word]*** b")).toBe("a **[word]** b");
		expect(bold("a ***[word]*** b")).toBe("a *[word]* b");
	});

	it("leaves the spaces at either end of a selection outside it", () => {
		expect(bold("a[ word ]b")).toBe("a **[word]** b");
		expect(bold("**a**[ and ]**b**")).toBe("**a** **[and]** **b**");
	});

	it("opens a span at the cursor, and steps out of one", () => {
		expect(bold("a |")).toBe("a **|**");
		expect(bold("a **|**")).toBe("a |");
		expect(bold("a **word|** b")).toBe("a **word**| b");
		expect(italic("a _word|_ b")).toBe("a _word_| b");
	});
});

describe("MarkdownUtils.isInCode", () => {
	/** Whether the character `|` marks (and is taken out of) is code. */
	const inCode = (marked: string) => {
		const offset = marked.indexOf("|");
		const value = marked.slice(0, offset) + marked.slice(offset + 1);
		return MarkdownUtils.isInCode(value, offset);
	};

	it("is code between the backticks of inline code", () => {
		expect(inCode("a `|/help` b")).toBe(true);
		expect(inCode("a ``x |/help`` b")).toBe(true);
	});

	it("is not code on or past the backticks", () => {
		expect(inCode("a |`x` /help")).toBe(false);
		expect(inCode("a `x` |/help")).toBe(false);
		expect(inCode("a `|/help")).toBe(false);
	});

	it("is code in a fenced block", () => {
		expect(inCode("```\n|/help\n```")).toBe(true);
		expect(inCode("```\n|/help")).toBe(true);
		expect(inCode("```\nx\n```\n|/help")).toBe(false);
	});
});
