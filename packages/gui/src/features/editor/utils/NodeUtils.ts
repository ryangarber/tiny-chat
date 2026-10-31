import type { EditorState } from "@tiptap/pm/state";
import type { NodeConfig } from "@tiptap/react";
import {
	EditorPartUtils,
	type zEditorPart,
} from "#core/features/data/utils/EditorPartUtils.ts";

/**
 * The parts a document is being serialized or parsed against, which its part
 * nodes stand in the Markdown for as their markers.
 *
 * Markdown is only what the text between the parts is written in: a part is
 * never written into it, so it has nothing to escape and nothing that can be
 * taken apart. The editor's Markdown is read and written in one go, so this
 * is only ever set for the length of a call — see `EditorUtils.getData` and
 * `EditorUtils.setData`.
 */
const markers = {
	/** By id, the index each part node is serialized as the marker of. */
	serializing: new Map<string, number>(),
	/** By index, the part each marker being parsed stands for. */
	parsing: [] as readonly zEditorPart[],
};

export const NodeUtils = {
	markers,

	/**
	 * Whether the character at a position is code: in a block of code, or
	 * marked as inline code. A trigger character written there is only ever the
	 * text it is.
	 */
	isInCode: (state: EditorState, pos: number) => {
		const $pos = state.doc.resolve(pos);
		if ($pos.parent.type.spec.code) return true;
		const char = state.doc.nodeAt(pos);
		return !!char?.marks.some((mark) => mark.type.spec.code);
	},

	/**
	 * The Markdown a part node is serialized as and parsed from: the marker of
	 * the part it holds the id of, and nothing else.
	 *
	 * A block part is never parsed out of Markdown, since `EditorUtils.setData`
	 * puts it into the document itself, between the runs of text either side.
	 *
	 * @param getContent The node's own content when it is parsed, for a node —
	 * 	a command — whose part is edited inside it.
	 */
	createPartMarker: ({
		nodeName,
		type = nodeName as zEditorPart["type"],
		getContent,
	}: {
		nodeName: string;
		type?: zEditorPart["type"];
		getContent?: (part: zEditorPart) => string | undefined;
	}): Partial<NodeConfig<any, any>> => {
		const marked = (character: string | undefined) => {
			const index = character ? EditorPartUtils.index(character) : null;
			const part = index === null ? undefined : markers.parsing[index];
			return part?.type === type ? part : null;
		};

		return {
			parseMarkdown(token, helpers) {
				return helpers.createNode(
					nodeName,
					{ id: token.attributes?.id },
					helpers.parseInline(token.tokens ?? []),
				);
			},

			markdownTokenizer: EditorPartUtils.isInline(type)
				? {
						name: nodeName,
						level: "inline",
						start(src) {
							for (const match of src.matchAll(EditorPartUtils.markers())) {
								if (marked(match[0])) return match.index;
							}
							return -1;
						},
						tokenize(src, _tokens, lexer) {
							const part = marked(src[0]);
							if (!part) return undefined;

							const content = getContent?.(part) ?? "";
							return {
								type: nodeName,
								attributes: { id: part.id },
								content,
								tokens: content ? lexer.inlineTokens(content) : [],
								raw: src[0],
							};
						},
					}
				: undefined,

			renderMarkdown(node) {
				const index = markers.serializing.get(node.attrs?.id);
				return index === undefined ? "" : EditorPartUtils.marker(index);
			},
		};
	},
} as const;
