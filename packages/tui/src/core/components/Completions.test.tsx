import { stripVTControlCharacters } from "node:util";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import Completions from "#tui/core/components/Completions.tsx";
import Text from "#tui/core/components/Text.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { render } from "#tui/core/utils/RenderTestUtils.tsx";

const ESC = "\x1b";

function List({ remove }: { remove: () => void }) {
	usePage({ onBack: () => false });
	return (
		<Completions
			groups={[
				{
					items: [
						{ name: "first", value: "1" },
						{ name: "second", value: "2" },
					],
				},
			]}
			bindings={{
				primary: { name: "open", run: () => {} },
				remove: { name: "delete", run: remove },
			}}
			actions={["back"]}
		/>
	);
}

const screen = async () => {
	const remove = vi.fn();
	const view = render(<List remove={remove} />);
	await view.idle();
	const frame = () => stripVTControlCharacters(view.lastFrame() ?? "");
	const press = async (input: string) => {
		view.stdin.write(input);
		await view.idle();
	};
	return { remove, frame, press };
};

describe("Completions removal", () => {
	it("draws the help in the shared order", async () => {
		const { frame } = await screen();
		expect(frame()).toContain("↑↓ move · enter open · d delete · esc back");
	});

	it("asks before deleting, and deletes on a second d", async () => {
		const { remove, frame, press } = await screen();
		await press("d");
		expect(remove).not.toHaveBeenCalled();
		expect(frame()).toContain('delete "first"?');
		expect(frame()).toContain("d confirm · esc cancel");
		await press("d");
		expect(remove).toHaveBeenCalledWith(
			expect.objectContaining({ value: "1" }),
		);
	});

	it("disarms when the cursor moves", async () => {
		const { remove, frame, press } = await screen();
		await press("d");
		await press(`${ESC}[B`);
		expect(frame()).not.toContain('delete "');
		await press("d");
		expect(remove).not.toHaveBeenCalled();
		expect(frame()).toContain('delete "second"?');
	});

	it("disarms on back without leaving the page", async () => {
		const { remove, frame, press } = await screen();
		await press("d");
		await press("\x7f");
		expect(frame()).toContain("enter open");
		await press("d");
		expect(remove).not.toHaveBeenCalled();
	});
});

function Nested({ remove }: { remove: () => void }) {
	const [open, setOpen] = useState(true);
	// The page beneath, which takes back too while the inner one is open.
	usePage({ onBack: () => false });
	usePage({
		active: open,
		onBack: () => {
			setOpen(false);
			return false;
		},
	});
	return open ? <List remove={remove} /> : <Text>closed</Text>;
}

describe("Completions removal under nested pages", () => {
	it("disarms on back without any page leaving", async () => {
		const view = render(<Nested remove={vi.fn()} />);
		await view.idle();
		view.stdin.write("d");
		await view.idle();
		view.stdin.write("\x7f");
		await view.idle();
		const frame = stripVTControlCharacters(view.lastFrame() ?? "");
		expect(frame).not.toContain("closed");
		expect(frame).toContain("enter open");
	});
});
