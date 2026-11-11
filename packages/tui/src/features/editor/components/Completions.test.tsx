import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { useCompletionStore } from "#client/features/editor/stores/useCompletionStore.ts";
import Panel from "#tui/core/components/Panel.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import Attachments from "#tui/features/editor/components/Attachments.tsx";
import Commands from "#tui/features/editor/components/Commands.tsx";
import { useEditorStore } from "#tui/features/editor/stores/useEditorStore.ts";
import render from "#tui/tests.ts";

function Composer({ attachment }: { attachment: boolean }) {
	const { content, cursor, setContent, setCursor } = useEditorStore();
	const Menu = attachment ? Attachments : Commands;
	return (
		<Panel id="editor">
			<Menu {...{ content, cursor, setContent, setCursor }} />
			<Text>draft: {content}</Text>
		</Panel>
	);
}

describe.each([
	{ name: "commands", attachment: false, trigger: "/" },
	{ name: "attachments", attachment: true, trigger: "@" },
	{ name: "command arguments", attachment: false, trigger: "/model " },
])("$name dismissal", ({ attachment, trigger }) => {
	it("stays dismissed through typing and movement within the token, then reopens on returning", async () => {
		useAppStore.getState().setFocus("editor");
		useEditorStore.setState({
			content: `${trigger}ab`,
			cursor: [0, trigger.length + 2],
		});
		const view = await render(<Composer attachment={attachment} />);
		await view.idle();
		const open = () => useCompletionStore.getState().isCompletionsOpen;
		const frame = () => stripVTControlCharacters(view.lastFrame() ?? "");
		expect(open()).toBe(true);
		expect(frame()).toContain("esc close");

		view.stdin.write("\x1b");
		await expect.poll(open).toBe(false);
		await view.idle();
		expect(frame()).not.toContain("esc close");

		// Typing still targets the same trigger, even if results arrive later.
		useEditorStore.setState({
			content: `${trigger}abc`,
			cursor: [0, trigger.length + 3],
		});
		await view.idle();
		expect(open()).toBe(false);
		useEditorStore.getState().setCursor([0, trigger.length + 1]);
		await view.idle();
		expect(open()).toBe(false);

		useEditorStore.getState().setCursor([0, 0]);
		await view.idle();
		expect(open()).toBe(false);
		useEditorStore.getState().setCursor([0, trigger.length + 3]);
		await view.idle();
		expect(open()).toBe(true);
		expect(frame()).toContain("esc close");
	});

	it("opens a different token and rearms the dismissed token", async () => {
		useAppStore.getState().setFocus("editor");
		useEditorStore.setState({
			content: `${trigger}ab\n${trigger}cd`,
			cursor: [0, trigger.length + 2],
		});
		const view = await render(<Composer attachment={attachment} />);
		await view.idle();
		const open = () => useCompletionStore.getState().isCompletionsOpen;
		expect(open()).toBe(true);
		view.stdin.write("\x1b");
		await expect.poll(open).toBe(false);
		useEditorStore.getState().setCursor([1, trigger.length + 2]);
		await view.idle();
		expect(open()).toBe(true);
		useEditorStore.getState().setCursor([0, trigger.length + 2]);
		await view.idle();
		expect(open()).toBe(true);
	});
});
