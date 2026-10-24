import type { Fragment, Node } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { Content, Editor, JSONContent } from "@tiptap/react";
import { useEditorPartStore } from "#client/features/editor/stores/useEditorPartStore.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { EditorNodeUtils } from "#client/features/editor/utils/EditorNodeUtils.ts";
import type { zData } from "#core/features/data/types/part.ts";
import {
	EditorPartUtils,
	type EditorRun,
	type zEditorPart,
} from "#core/features/data/utils/EditorPartUtils.ts";
import { hasPendingCommandNode } from "#gui/features/editor/hooks/useCommand.tsx";
import { useEditorStore } from "#gui/features/editor/stores/useEditorStore.ts";
import { NodeUtils } from "#gui/features/editor/utils/NodeUtils.ts";

/** The node a part stands in the document as. */
const NODE_NAMES: Record<zEditorPart["type"], string> = {
	attachment: "attachment",
	command: "command",
	quote: "quote",
	paste: "pasteBlock",
};

const PART_TYPES = Object.fromEntries(
	Object.entries(NODE_NAMES).map(([type, name]) => [name, type]),
) as Record<string, zEditorPart["type"]>;

/** Tiptap's Markdown manager, which reads and writes the text between parts. */
const markdown = (editor: Editor) =>
	(
		editor.storage as unknown as {
			markdown: {
				manager: {
					parse: (markdown: string) => JSONContent;
					serialize: (content: JSONContent) => string;
				};
			};
		}
	).markdown.manager;

export const EditorUtils = {
	/**
	 * The message the document holds: its text as the Markdown it is written
	 * in, and the parts standing among it as themselves.
	 *
	 * Each part node is serialized as the marker of its part, which is then cut
	 * back out of the Markdown — so a part is never written into it at all.
	 */
	getData: (editor: Editor): zData => {
		const parts: zEditorPart[] = [];
		const { serializing } = NodeUtils.markers;

		editor.state.doc.descendants((node) => {
			const type = PART_TYPES[node.type.name];
			if (!type) return true;

			const part = useEditorPartStore.getState().parts[node.attrs.id];
			if (part?.type === type) {
				serializing.set(part.id, parts.length);
				parts.push(part);
			}
			return true;
		});

		try {
			return [EditorPartUtils.split({ source: editor.getMarkdown(), parts })];
		} finally {
			serializing.clear();
		}
	},

	/**
	 * The inverse of {@link EditorUtils.getData}: a message written into the
	 * document. Each run of text, with the inline parts in among it, is parsed
	 * from the Markdown it is written in; a quote or a paste goes in between
	 * them as its own node.
	 */
	setData: (editor: Editor, data: zData) => {
		const run = data.flat().filter(EditorPartUtils.isRun);
		useEditorPartStore.getState().setParts(run.filter(EditorPartUtils.is));

		const content: JSONContent[] = [];
		let text: EditorRun = [];

		const flush = () => {
			const { source, parts } = EditorPartUtils.join(text);
			text = [];
			if (!source.trim()) return;

			NodeUtils.markers.parsing = parts;
			try {
				content.push(
					...(markdown(editor).parse(source.replace(/^\n+|\n+$/g, ""))
						.content ?? []),
				);
			} finally {
				NodeUtils.markers.parsing = [];
			}
		};

		for (const part of run) {
			if (part.type === "text" || EditorPartUtils.isInline(part.type)) {
				text.push(part);
				continue;
			}

			flush();
			content.push({ type: NODE_NAMES[part.type], attrs: { id: part.id } });
		}
		flush();

		editor.commands.setContent({ type: "doc", content });
	},

	/**
	 * Insert a paste folded away when it is long, or as a code block when it
	 * looks like source. Returns false when the editor should keep its default
	 * paste.
	 */
	insertPasted: (text: string) => {
		const { editor } = useEditorStore.getState();
		if (!editor) return false;

		if (editor.isActive("codeBlock") || editor.isActive("pasteBlock")) {
			return false;
		}

		const paste = EditorNodeUtils.paste(text);
		if (paste?.type === "node") return EditorUtils.insertNode(paste.node);
		if (paste?.type === "code") return EditorUtils.insertCode(paste);
		return false;
	},

	insertCode: ({
		text,
		language,
	}: {
		text: string;
		language?: string | null;
	}) =>
		EditorUtils.insert({
			type: "codeBlock",
			attrs: { language },
			content: text ? [{ type: "text", text }] : [],
		}),

	/**
	 * Write a pointer to an already-registered part in wherever the cursor is.
	 *
	 * Every kind goes in the same way — the node carries the id and the node
	 * view reads the part — apart from a paste from before every paste was
	 * folded away, which is the code block it stood for.
	 */
	insertNode: (node: EditorNode) => {
		const part = EditorNodeUtils.part(node);
		if (!part) return false;

		if (part.type === "paste" && part.collapsed === false) {
			return EditorUtils.insertCode(part);
		}

		const pointer = { type: NODE_NAMES[part.type], attrs: { id: node.id } };

		// An inline chip is typed on past, so it is given somewhere to land.
		return EditorUtils.insert(
			EditorPartUtils.isInline(part.type)
				? [pointer, { type: "text", text: " " }]
				: pointer,
		);
	},

	insert: (content: Content | Node | Fragment) => {
		const { editor } = useEditorStore.getState();
		if (!editor) return false;

		return editor
			.chain()
			.focus()
			.insertContent(content)
			.command(({ tr, dispatch, editor }) => {
				if (!dispatch) return true;

				const end = tr.selection.to;
				const cursor = () => Selection.findFrom(tr.doc.resolve(end), 1, true);

				// An atom block — a quote or a paste — inserted at the end of the
				// document leaves nowhere to type: the paragraph the trailing node
				// extension adds only lands once this transaction has gone through,
				// by which time the selection has fallen back onto the block itself.
				if (!cursor()) {
					const paragraph = editor.schema.nodes.paragraph?.createAndFill();
					if (paragraph) tr.insert(end, paragraph);
				}

				const selection = cursor();
				if (selection) tr.setSelection(selection);

				return true;
			})
			.run();
	},

	getIncomplete: () => {
		const { editor } = useEditorStore.getState();
		if (!editor) return false;

		return hasPendingCommandNode(editor);
	},
} as const;
