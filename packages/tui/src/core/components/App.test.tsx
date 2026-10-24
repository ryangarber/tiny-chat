import { stripVTControlCharacters } from "node:util";
import { beforeEach, expect, it, vi } from "vitest";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import App from "#tui/core/components/App.tsx";
import { selectFocus, useAppStore } from "#tui/core/stores/useAppStore.ts";
import { useEditorStore } from "#tui/features/editor/stores/useEditorStore.ts";
import render from "#tui/tests.ts";

beforeEach(() => {
	useAppStore.setState({
		focus: "editor",
		statuses: [],
	});
	useLayoutStore.setState({ panels: { chats: false, files: false } });
	useEditorStore.setState({
		content: "",
		cursor: [0, 0],
		selection: null,
	});
});

const focus = () => selectFocus(useAppStore.getState());

it("keeps panels open through focus changes and only routes keys to the focused surface", async () => {
	const screen = await render(<App />);
	useAppStore.getState().togglePanel("chats");
	useAppStore.getState().togglePanel("files");
	await screen.idle();
	const press = async (key: string) => {
		screen.stdin.write(key);
		await screen.idle();
	};

	await press("\t");
	expect(focus()).toBe("editor");
	await press("hello");
	await press("\x7f");
	expect(useEditorStore.getState().content).toBe("hell");
	expect(useLayoutStore.getState().panels).toEqual({
		chats: true,
		files: true,
	});

	await press("\t");
	expect(focus()).toBe("chats");
	await press("\t");
	expect(focus()).toBe("files");
	await press("x");
	expect(useLayoutStore.getState().panels).toEqual({
		chats: true,
		files: false,
	});
	expect(focus()).toBe("editor");
	expect(useEditorStore.getState().content).toBe("hell");

	await press("\t");
	expect(focus()).toBe("chats");
	screen.stdin.write("\x1b");
	// Escape crosses two ambiguity timers (our filter and Ink). A quiet frame
	// or a fixed sleep does not mean either parser has delivered the key.
	await vi.waitFor(() =>
		expect(useLayoutStore.getState().panels).toEqual({
			chats: false,
			files: false,
		}),
	);
	expect(focus()).toBe("editor");
});

it("opens panels with their commands without hiding the other panel", async () => {
	const screen = await render(<App />);
	const run = async (...inputs: string[]) => {
		for (const input of inputs) {
			screen.stdin.write(input);
			await screen.idle();
			screen.stdin.write("\r");
			await screen.idle();
		}
	};
	// The chats are offered as choices; the full list is the last of them.
	await run("/chats", "more");
	await vi.waitFor(() =>
		expect(useLayoutStore.getState().panels.chats).toBe(true),
	);
	screen.stdin.write("\t");
	await screen.idle();
	await run("/files");
	await vi.waitFor(() =>
		expect(useLayoutStore.getState().panels).toEqual({
			chats: true,
			files: true,
		}),
	);
	screen.stdin.write("\t");
	await screen.idle();
	await run("/files");
	await vi.waitFor(() =>
		expect(useLayoutStore.getState().panels).toEqual({
			chats: true,
			files: false,
		}),
	);
});

it("keeps equal-width panels visible across terminal resizing and closes them by mouse", async () => {
	const screen = await render(<App />);
	useAppStore.getState().togglePanel("chats");
	useAppStore.getState().togglePanel("files");
	const frame = () => stripVTControlCharacters(screen.lastFrame() ?? "");
	for (const columns of [160, 120, 100]) {
		screen.stdout.columns = columns;
		screen.stdout.emit("resize");
		await screen.idle();
		const header = frame()
			.split("\n")
			.find((line) => line.includes("chats") && line.includes("files"));
		expect(header).toBeDefined();
		const line = header ?? "";
		expect(line.indexOf("[×]") - line.indexOf("chats")).toBe(
			line.lastIndexOf("[×]") - line.indexOf("files"),
		);
		expect(useLayoutStore.getState().panels).toEqual({
			chats: true,
			files: true,
		});
	}
	const lines = frame().split("\n");
	const row = lines.findIndex(
		(line) => line.includes("chats") && line.includes("files"),
	);
	const column = lines[row].lastIndexOf("[×]") + 2;
	screen.stdin.write(
		`\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`,
	);
	await vi.waitFor(() =>
		expect(useLayoutStore.getState().panels).toEqual({
			chats: true,
			files: false,
		}),
	);
});

it("knows the focusables on screen, in Tab order, and falls back to the editor", async () => {
	const screen = await render(<App />);
	useAppStore.getState().togglePanel("files");
	useAppStore.getState().togglePanel("chats");
	await screen.idle();
	expect(useAppStore.getState().focusables).toEqual([
		"editor",
		"chats",
		"files",
	]);
	expect(focus()).toBe("chats");

	// A focus that leaves the screen hands it back to the editor.
	useAppStore.setState({ focus: "tool:gone" });
	expect(focus()).toBe("editor");

	useAppStore.getState().cycleFocus(-1);
	expect(focus()).toBe("files");
	useAppStore.getState().closePanel("files");
	await screen.idle();
	expect(useAppStore.getState().focusables).toEqual(["editor", "chats"]);
	expect(focus()).toBe("editor");
});
