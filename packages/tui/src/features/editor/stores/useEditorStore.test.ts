import { TextareaUtils } from "better-ink-ui";
import { getEditorPart } from "#client/features/editor/stores/useEditorPartStore.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";
import { EditorNodeUtils } from "#client/features/editor/utils/EditorNodeUtils.ts";
import { useEditorStore } from "#tui/features/editor/stores/useEditorStore.ts";

const PASTED = Array.from({ length: 12 }, (_, index) => `row ${index}`).join(
	"\n",
);

/** A long paste standing in the editor as its atom, between two words. */
const setUp = () => {
	const paste = EditorNodeUtils.paste(PASTED);
	if (paste?.type !== "node") throw new Error("the paste was not collapsed");
	const { node } = paste;

	const atom = AtomUtils.fromNode({ content: "", node });
	const content = `before ${atom} after`;
	useEditorStore.setState({
		content,
		cursor: TextareaUtils.cursor(content, 0),
		unfolded: null,
	});

	return { atom, id: node.id, start: "before ".length };
};

const state = () => useEditorStore.getState();
const moveTo = (offset: number) =>
	useEditorStore.setState({
		cursor: TextareaUtils.cursor(state().content, offset),
	});

describe("an unfolded paste", () => {
	it("opens in full where its atom was clicked", () => {
		const { atom, start } = setUp();

		expect(state().unfold(start + 2)).toBe(true);
		expect(state().content).toBe(`before ${PASTED} after`);
		expect(TextareaUtils.offset(state().content, state().cursor)).toBe(start);

		// Not on the atom, so nothing opens.
		setUp();
		expect(state().unfold(1)).toBe(false);
		expect(state().content).toBe(`before ${atom} after`);
	});

	it("stays open while the cursor is inside it, and folds when it leaves", () => {
		const { id, start } = setUp();
		state().unfold(start);

		moveTo(start + PASTED.length);
		state().refold();
		expect(state().unfolded).not.toBe(null);

		moveTo(start + PASTED.length + 2);
		state().refold();
		expect(state().unfolded).toBe(null);
		expect(state().content).toBe(`before ${AtomUtils.atoms()[0].text} after`);
		expect(getEditorPart("paste", id)?.text).toBe(PASTED);
		// Still two characters past the end of what was the paste.
		expect(TextareaUtils.offset(state().content, state().cursor)).toBe(
			state().content.length - "fter".length,
		);
	});

	it("keeps what was edited inside it", () => {
		const { id, start } = setUp();
		state().unfold(start);

		state().insert("row -1\n");
		moveTo(0);
		state().refold();

		const part = getEditorPart("paste", id);
		expect(part?.text).toBe(`row -1\n${PASTED}`);
		expect(part?.lines).toBe(13);
		expect(state().content).toBe("before [13 pasted lines] after");
	});

	it("is left as text once emptied", () => {
		const { start } = setUp();
		state().unfold(start);

		const { content } = state();
		useEditorStore.setState({
			content: content.slice(0, start) + content.slice(start + PASTED.length),
		});
		moveTo(0);
		state().refold();

		expect(state().content).toBe("before  after");
	});

	it("is left as text once cut down to where it would not fold", () => {
		const { id, start } = setUp();
		state().unfold(start);

		const { content } = state();
		const kept = "row 0\nrow 1";
		useEditorStore.setState({
			content:
				content.slice(0, start) + kept + content.slice(start + PASTED.length),
		});
		moveTo(0);
		state().refold();

		expect(state().content).toBe(`before ${kept} after`);
		expect(getEditorPart("paste", id)?.text).toBe(PASTED);
	});

	it("folds up wherever the cursor is, on its way out", () => {
		const { start } = setUp();
		state().unfold(start);

		state().refold(true);
		expect(state().content).toBe("before [12 pasted lines] after");
	});
});
