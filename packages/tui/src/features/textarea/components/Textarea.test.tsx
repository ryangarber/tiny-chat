import { stripVTControlCharacters } from "node:util";
import { useWindowSize } from "ink";
import { useContext, useEffect, useState } from "react";
import { vi } from "vitest";
import { ThemeContext } from "#client/core/components/ThemeContext.tsx";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";
import { MarkdownUtils } from "#tui/features/editor/utils/MarkdownUtils.ts";
import { useSelectionStore } from "#tui/features/selection/stores/useSelectionStore.ts";
import Textarea, {
	type TextareaProps,
} from "#tui/features/textarea/components/Textarea.tsx";
import render from "#tui/tests.ts";

/** Keys as a terminal sends them. */
const KEY = {
	enter: "\r",
	shiftEnter: "\x1b[13;2u",
	altEnter: "\x1b\r",
	ctrlEnter: "\x1b[13;5u",
	xtermCtrlEnter: "\x1b[27;5;13~",
	backspace: "\x7f",
	altBackspace: "\x1b\x7f",
	kittyAltBackspace: "\x1b[127;3u",
	ctrlW: "\x17",
	altDelete: "\x1b[3;3~",
	altD: "\x1bd",
	delete: "\x1b[3~",
	left: "\x1b[D",
	right: "\x1b[C",
	up: "\x1b[A",
	down: "\x1b[B",
	shiftLeft: "\x1b[1;2D",
	altLeft: "\x1b[1;3D",
	ctrlA: "\x01",
	ctrlC: "\x03",
	ctrlX: "\x18",
	ctrlZ: "\x1a",
	ctrlY: "\x19",
	/** Ctrl+Shift+Z, which only the kitty protocol tells from Ctrl+Z. */
	kittyCtrlShiftZ: "\x1b[122;6u",
	shiftTab: "\x1b[Z",
	tab: "\t",
	/** The wheel turned a step down, over the given row of the terminal. */
	wheelDown: (row: number) => `\x1b[<65;1;${row}M`,
	wheelUp: (row: number) => `\x1b[<64;1;${row}M`,
	/** A click on a column and a row of the terminal, both from 1. */
	click: (column: number, row: number) =>
		`\x1b[<0;${column};${row}M\x1b[<0;${column};${row}m`,
	paste: (text: string) => `\x1b[200~${text}\x1b[201~`,
};

function Field({
	initial,
	onRows,
	...props
}: Partial<TextareaProps> & {
	initial: string;
	onRows: (rows: number) => void;
}) {
	const [value, setValue] = useState(initial);
	const { rows } = useWindowSize();
	useEffect(() => {
		onRows(rows);
	}, [onRows, rows]);
	return (
		<Textarea
			focus
			{...props}
			value={value}
			onChange={(next) => {
				props.onChange?.(next);
				setValue(next);
			}}
		/>
	);
}

/** A text area holding its own value, which is read back through `state`. */
async function field(
	props: Partial<TextareaProps> & { initial?: string } = {},
) {
	const state = { value: props.initial ?? "", rows: 0 };

	const screen = await render(
		<Field
			{...props}
			initial={state.value}
			onChange={(next) => {
				state.value = next;
			}}
			onRows={(rows) => {
				state.rows = rows;
			}}
		/>,
	);
	await screen.idle();

	return {
		state,
		frame: () => stripVTControlCharacters(screen.lastFrame() ?? ""),
		press: async (...keys: string[]) => {
			for (const key of keys) {
				screen.stdin.write(key);
				await screen.idle();
			}
		},
		done: () => {
			screen.unmount();
			screen.cleanup();
		},
	};
}

beforeEach(() => {
	// Copying hands the text to the clipboard, which a test has no business
	// writing over.
	vi.spyOn(ClipboardService, "copy").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("typing", () => {
	it("writes what is typed at the cursor", async () => {
		const screen = await field();
		await screen.press("h", "e", "y", KEY.left, KEY.left, "!");

		expect(screen.state.value).toBe("h!ey");
		screen.done();
	});

	it.each(["ab", KEY.paste("ab")])(
		"preserves edits when %j and keys arrive in one read",
		async (text) => {
			const screen = await field();
			await screen.press(`${text}${KEY.left}!`);
			expect(screen.state.value).toBe("a!b");
			screen.done();
		},
	);

	it("preserves wire order when typing, clicking and typing share a read", async () => {
		const screen = await field();
		await screen.press(`abc${KEY.click(2, screen.state.rows)}!`);
		expect(screen.state.value).toBe("a!bc");
		screen.done();
	});

	it("applies repeated backspace bytes individually", async () => {
		const screen = await field({ initial: "abcd" });
		await screen.press(KEY.down, KEY.backspace + KEY.backspace);
		expect(screen.state.value).toBe("ab");
		screen.done();
	});

	it("breaks the line on Enter and on Shift and Enter", async () => {
		const screen = await field();
		await screen.press("a", KEY.enter, "b", KEY.shiftEnter, "c");

		expect(screen.state.value).toBe("a\nb\nc");
		expect(
			screen
				.frame()
				.split("\n")
				.map((line) => line.trim()),
		).toEqual(["a", "b", "c"]);
		screen.done();
	});

	it("hands a plain Enter over, but never Shift and Enter", async () => {
		const onEnter = vi.fn();
		const screen = await field({ onEnter });
		await screen.press("a", KEY.enter, KEY.shiftEnter);

		expect(onEnter).toHaveBeenCalledTimes(1);
		expect(screen.state.value).toBe("a\n");
		screen.done();
	});

	it("submits on Enter under Ctrl, Alt or Meta", async () => {
		const onSubmit = vi.fn();
		const screen = await field({ onSubmit, initial: "sent" });
		await screen.press(KEY.altEnter, KEY.ctrlEnter, KEY.xtermCtrlEnter);

		expect(onSubmit).toHaveBeenCalledTimes(3);
		expect(onSubmit).toHaveBeenCalledWith("sent");
		expect(screen.state.value).toBe("sent");
		screen.done();
	});

	it("handles xterm Shift and Alt Return as keys, not text suffixes", async () => {
		const onSubmit = vi.fn();
		const screen = await field({ onSubmit });
		await screen.press("[27;5;13~", "\x1b[27;2;13~", "\x1b[27;3;13~");
		expect(screen.state.value).toBe("[27;5;13~\n");
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("[27;5;13~\n");
		screen.done();
	});

	it("does not insert, delete or submit on Kitty key releases", async () => {
		const onSubmit = vi.fn();
		const screen = await field({ onSubmit });
		await screen.press(
			"\x1b[97;1:1u",
			"\x1b[97;1:2u",
			"\x1b[97;1:3u",
			"\x1b[127;1:3u",
			"\x1b[13;5:3u",
		);
		expect(screen.state.value).toBe("aa");
		expect(onSubmit).not.toHaveBeenCalled();
		screen.done();
	});

	it("leaves a tab and the Ctrl keys out of the value", async () => {
		const screen = await field();
		await screen.press("a", KEY.tab, "\x05", "\x0b", "\x0e", "b");

		expect(screen.state.value).toBe("ab");
		screen.done();
	});

	it("lets a key be taken from it", async () => {
		const screen = await field({ onKey: (input) => input === "x" });
		await screen.press("a", "x", "b");

		expect(screen.state.value).toBe("ab");
		screen.done();
	});
});

describe("deleting", () => {
	it("takes a character back, or forward", async () => {
		const screen = await field({ initial: "abcd" });
		await screen.press(KEY.right, KEY.right, KEY.backspace, KEY.delete);

		expect(screen.state.value).toBe("ad");
		screen.done();
	});

	it("takes a word back under Alt", async () => {
		const screen = await field({ initial: "one two" });
		await screen.press(KEY.down, KEY.altBackspace);

		expect(screen.state.value).toBe("one ");
		screen.done();
	});

	it("takes a word under Option, however the terminal sends it", async () => {
		for (const key of [KEY.kittyAltBackspace, KEY.ctrlW]) {
			const screen = await field({ initial: "one two" });
			await screen.press(KEY.down, key);

			expect(screen.state.value).toBe("one ");
			screen.done();
		}

		for (const key of [KEY.altDelete, KEY.altD]) {
			const screen = await field({ initial: "one two" });
			await screen.press(key);

			expect(screen.state.value).toBe("two");
			screen.done();
		}
	});

	it("hands Option and a delete on as Alt and the delete", async () => {
		const pressed: string[] = [];
		const screen = await field({
			initial: "one two",
			onKey: (_input, key) => {
				if (key.meta && key.backspace) pressed.push("backspace");
				if (key.meta && key.delete) pressed.push("delete");
				return key.meta;
			},
		});
		await screen.press(KEY.ctrlW, KEY.altD);

		expect(pressed).toEqual(["backspace", "delete"]);
		expect(screen.state.value).toBe("one two");
		screen.done();
	});

	it("takes a whole grapheme at a time", async () => {
		const screen = await field({ initial: "a👍🏽" });
		await screen.press(KEY.down, KEY.backspace);

		expect(screen.state.value).toBe("a");
		screen.done();
	});
});

describe("moving", () => {
	it("goes to the start from the first row, and the end from the last", async () => {
		const screen = await field({ initial: "abc" });
		await screen.press(KEY.right, KEY.up, "<", KEY.down, ">");

		expect(screen.state.value).toBe("<abc>");
		screen.done();
	});

	it("holds the column across lines", async () => {
		const screen = await field({ initial: "abc\ndef" });
		await screen.press(KEY.right, KEY.right, KEY.down, "|");

		expect(screen.state.value).toBe("abc\nde|f");
		screen.done();
	});

	it("steps a word at a time under Alt", async () => {
		const screen = await field({ initial: "one two" });
		await screen.press(KEY.down, KEY.altLeft, "|");

		expect(screen.state.value).toBe("one |two");
		screen.done();
	});

	it("steps over a run that only goes whole", async () => {
		// "[a]" goes whole: a cursor never comes to rest inside it.
		const snap = (offset: number, from = offset) =>
			offset > 1 && offset < 4 ? (from <= 1 ? 4 : 1) : offset;
		const screen = await field({ initial: "x[a]y", snap });
		await screen.press(KEY.right, KEY.right, "|");

		expect(screen.state.value).toBe("x[a]|y");
		screen.done();
	});
});

describe("clicking", () => {
	it("hands over where a click landed, inside a run that goes whole too", async () => {
		const clicked: number[] = [];
		// "[a]" goes whole, so a cursor clicked into it is snapped out.
		const snap = (offset: number) => (offset > 1 && offset < 4 ? 4 : offset);
		const screen = await field({
			initial: "x[a]y",
			snap,
			onKey: (input) => input.startsWith("[<"),
			onClick: (offset) => {
				clicked.push(offset);
				return offset === 2;
			},
		});
		const bottom = screen.state.rows;

		// Left to the text area, which snaps the cursor out of the run…
		await screen.press(KEY.click(4, bottom));
		// …and taken from it, which leaves the cursor where it was.
		await screen.press(KEY.click(3, bottom), "!");

		expect(clicked).toEqual([3, 2]);
		expect(screen.state.value).toBe("x[a]!y");
		screen.done();
	});
});

describe("selecting", () => {
	it("selects with a split Terminal.app escaped arrow", async () => {
		const screen = await field({ initial: "abc" });
		await screen.press(KEY.down, "\x1b\x1b[", "D", "!");
		expect(screen.state.value).toBe("ab!");
		screen.done();
	});

	it("replaces what Shift and an arrow selected", async () => {
		const screen = await field({ initial: "abc" });
		await screen.press(KEY.down, KEY.shiftLeft, KEY.shiftLeft, "X");

		expect(screen.state.value).toBe("aX");
		screen.done();
	});

	it("selects everything on Ctrl and A, and deletes it whole", async () => {
		const screen = await field({ initial: "one\ntwo" });
		await screen.press(KEY.ctrlA, KEY.backspace);

		expect(screen.state.value).toBe("");
		screen.done();
	});

	it("leaves the clipboard alone while selecting", async () => {
		const screen = await field({ initial: "abc" });
		await screen.press(KEY.down, KEY.shiftLeft, KEY.ctrlA);

		expect(ClipboardService.copy).not.toHaveBeenCalled();
		screen.done();
	});

	it("copies the selection on Ctrl and C, and keeps it", async () => {
		const screen = await field({ initial: "abc" });
		await screen.press(KEY.down, KEY.shiftLeft, KEY.ctrlC);

		expect(ClipboardService.copy).toHaveBeenCalledWith("c");
		expect(useSelectionStore.getState().holder).not.toBeNull();
		await screen.press("!");
		expect(screen.state.value).toBe("ab!");
		screen.done();
	});

	it("cuts the selection to the clipboard on Ctrl and X", async () => {
		const screen = await field({ initial: "abc" });
		await screen.press(KEY.down, KEY.shiftLeft, KEY.ctrlX);

		expect(ClipboardService.copy).toHaveBeenCalledWith("c");
		expect(screen.state.value).toBe("ab");
		screen.done();
	});

	it("collapses to the side an arrow points at", async () => {
		const screen = await field({ initial: "abc" });
		await screen.press(KEY.down, KEY.shiftLeft, KEY.shiftLeft, KEY.left, "|");

		expect(screen.state.value).toBe("a|bc");
		screen.done();
	});
});

describe("undo", () => {
	it("takes back a run of typing at once, and puts it back", async () => {
		const screen = await field();
		await screen.press("a", "b", "c", KEY.ctrlZ);
		expect(screen.state.value).toBe("");

		await screen.press(KEY.ctrlY);
		expect(screen.state.value).toBe("abc");
		screen.done();
	});

	it("redoes on Ctrl+Shift+Z", async () => {
		const screen = await field();
		await screen.press("a", "b", KEY.ctrlZ, KEY.kittyCtrlShiftZ);
		expect(screen.state.value).toBe("ab");
		screen.done();
	});

	it("takes back an edit made in place of a key", async () => {
		const screen = await field({
			initial: "- one\n- two",
			onKey: (_, key) =>
				key.tab
					? MarkdownUtils.indented({
							value: screen.state.value,
							selection: [12, 12],
							direction: key.shift ? -1 : 1,
						})
					: undefined,
		});
		await screen.press(KEY.tab);
		expect(screen.state.value).toBe("- one\n  - two");

		await screen.press(KEY.ctrlZ);
		expect(screen.state.value).toBe("- one\n- two");
		screen.done();
	});
});

describe("pasting", () => {
	it("inserts a paste whole, its returns as newlines", async () => {
		const screen = await field({ initial: "[]" });
		await screen.press(KEY.right, KEY.paste("a\r\nb"));

		expect(screen.state.value).toBe("[a\nb]");
		screen.done();
	});

	it("hands a paste over when it is taken", async () => {
		const onPaste = vi.fn();
		const screen = await field({ onPaste });
		await screen.press(KEY.paste("a\rb"));

		expect(onPaste).toHaveBeenCalledWith("a\nb");
		expect(screen.state.value).toBe("");
		screen.done();
	});
});

describe("drawing", () => {
	it("draws the placeholder while it is empty, focused or not", async () => {
		const unfocused = await field({ focus: false, placeholder: "say hi" });
		expect(unfocused.frame()).toContain("say hi");
		unfocused.done();

		const focused = await field({ placeholder: "say hi" });
		expect(focused.frame()).toContain("say hi");
		focused.done();
	});

	it("scrolls under the wheel, and back to the cursor on the next key", async () => {
		const lines = Array.from({ length: 40 }, (_, index) => `line ${index}`);
		const screen = await field({
			initial: lines.join("\n"),
			// The app takes mouse reports out of the input before it reaches a
			// key handler, which the harness has nothing to do for it.
			onKey: (input) => input.startsWith("[<"),
		});
		const first = () => screen.frame().split("\n")[0].trim();
		const height = screen.frame().split("\n").length;

		expect(first()).toBe("line 0");

		// The text area sits at the bottom of the terminal, its last row there.
		const bottom = screen.state.rows;
		await screen.press(KEY.wheelDown(bottom), KEY.wheelDown(bottom));
		expect(first()).toBe("line 2");

		await screen.press(KEY.wheelUp(bottom));
		expect(first()).toBe("line 1");

		// Never past either end.
		await screen.press(
			...Array.from({ length: 40 }, () => KEY.wheelDown(bottom)),
		);
		expect(first()).toBe(`line ${40 - height}`);

		// The cursor is still on the first line, which a key brings back.
		await screen.press("x");
		expect(first()).toBe("xline 0");
		screen.done();
	});

	it("wraps a long line into rows of its width", async () => {
		const screen = await field({ initial: "x".repeat(150) });
		const rows = screen.frame().split("\n");

		expect(rows).toHaveLength(2);
		expect(rows[0].trim()).toBe("x".repeat(100));
		screen.done();
	});
});

/** The text area as the editor sets it up, drawn over markdown. */
function Markdown({ value }: { value: string }) {
	const { colorScheme } = useContext(ThemeContext);

	return (
		<Textarea
			focus={false}
			value={value}
			onChange={() => {}}
			labels={MarkdownUtils.labels()}
			styles={MarkdownUtils.styles(colorScheme)}
		/>
	);
}

describe("markdown in the editor", () => {
	/**
	 * Every rule run against a value by the text area itself, which is where a
	 * pattern it cannot take would throw, and the syntax left standing under it.
	 * What the labels are painted under is checked over the rules themselves, in
	 * `MarkdownUtils.test.tsx`.
	 */
	it("draws the markdown it styles without taking any of it away", async () => {
		const value = [
			"# Heading",
			"- item *one*",
			"- [ ] todo `read()`",
			"> quoted **hard**",
			"",
			"```ts",
			"const a = b;",
			"```",
			"see [docs](https://x.dev) ~~gone~~",
		].join("\n");

		const screen = await render(<Markdown value={value} />);
		const frame = stripVTControlCharacters(screen.lastFrame() ?? "");

		for (const line of value.split("\n")) {
			if (line) expect(frame).toContain(line);
		}

		screen.unmount();
		screen.cleanup();
	});
});
