import type { CommandGroup } from "#client/features/editor/types/command.ts";
import { CommandUtils } from "#client/features/editor/utils/CommandUtils.ts";

describe("CommandUtils", () => {
	it("matches command names without typing punctuation", () => {
		const groups: CommandGroup[] = [
			{ items: [{ name: "set-preset", value: "set-preset" }] },
		];

		expect(
			CommandUtils.filter({ groups, query: "setpres" })[0].items.map(
				(item) => item.value,
			),
		).toEqual(["set-preset"]);
	});

	it("puts an exact command match before commands containing it", () => {
		const groups: CommandGroup[] = [
			{
				items: [
					{ name: "set-preset", value: "set-preset" },
					{ name: "unset-preset", value: "unset-preset" },
					{ name: "preset", value: "preset" },
				],
			},
		];

		expect(
			CommandUtils.filter({ groups, query: "preset" })[0].items.map(
				(item) => item.value,
			),
		).toEqual(["preset", "set-preset", "unset-preset"]);
	});

	describe("match", () => {
		const groups: CommandGroup[] = [
			{
				items: [
					{
						name: "model",
						value: "model",
						choices: [{ items: [{ name: "gpt", value: "gpt" }] }],
					},
					{ name: "settings", value: "settings" },
				],
			},
		];

		it("reads a command's name while it is typed", () => {
			expect(CommandUtils.match({ line: "hi /mo", groups })).toEqual({
				command: null,
				text: "mo",
				from: 3,
				textFrom: 4,
				to: 6,
			});
		});

		it("opens a command's argument once its name is followed by a space", () => {
			const match = CommandUtils.match({ line: "/model g", groups });
			expect(match?.command?.name).toBe("model");
			expect(match).toMatchObject({ text: "g", from: 0, textFrom: 7, to: 8 });
			expect(CommandUtils.match({ line: "/model ", groups })?.text).toBe("");
		});

		it("closes on a space after a command that takes no argument", () => {
			expect(CommandUtils.match({ line: "/settings ", groups })).toBeNull();
			expect(CommandUtils.match({ line: "/nothing ", groups })).toBeNull();
		});

		it("needs the slash to start a word", () => {
			expect(CommandUtils.match({ line: "a/b", groups })).toBeNull();
			expect(CommandUtils.match({ line: "\uFFFC/mo", groups })).toBeNull();
		});
	});
});
