import { useHotkeys } from "@mantine/hooks";
import { Markdown } from "@tiptap/markdown";
import type { Slice } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
	useEditor as _useEditor,
	Extension,
	type JSONContent,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ClientContext } from "#client/client.ts";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import { MarkdownUtils } from "#client/features/message/utils/MarkdownUtils.ts";
import { useUploads } from "#client/features/upload/hooks/useUploads.ts";
import { useAttachment } from "#gui/features/editor/hooks/useAttachment.tsx";
import { useBlockquote } from "#gui/features/editor/hooks/useBlockquote.tsx";
import { useCodeBlock } from "#gui/features/editor/hooks/useCodeBlock.tsx";
import { useCommand } from "#gui/features/editor/hooks/useCommand.tsx";
import { useDocument } from "#gui/features/editor/hooks/useDocument.tsx";
import { useLink } from "#gui/features/editor/hooks/useLink.tsx";
import { usePaste } from "#gui/features/editor/hooks/usePaste.tsx";
import { usePlaceholder } from "#gui/features/editor/hooks/usePlaceholder.tsx";
import { useEditorStore } from "#gui/features/editor/stores/useEditorStore.ts";
import { EditorUtils } from "#gui/features/editor/utils/EditorUtils.ts";

/** How long after Ctrl or Cmd, Shift and V a paste is waited on, and taken as plain. */
const PLAIN_PASTE_WINDOW = 100;

const EnterKeymap = Extension.create({
	name: "enterKeymap",
	addKeyboardShortcuts() {
		const enter = () =>
			this.editor.commands.first(({ commands }) => [
				() => commands.newlineInCode(),
				() => commands.createParagraphNear(),
				() => commands.liftEmptyBlock(),
				() => commands.splitBlock(),
			]);

		return { "Shift-Enter": enter };
	},
});

function dropOutsideAtom(
	view: EditorView,
	event: DragEvent,
	slice: Slice,
	moved: boolean,
) {
	const eventPos = view.posAtCoords({
		left: event.clientX,
		top: event.clientY,
	});
	if (!eventPos) return false;

	const $event = view.state.doc.resolve(eventPos.pos);
	let atom =
		eventPos.inside >= 0 ? view.state.doc.nodeAt(eventPos.inside) : null;
	let atomPos = eventPos.inside;

	if (!atom?.type.spec.atom) {
		let atomDepth = $event.depth;
		while (atomDepth > 0 && !$event.node(atomDepth).type.spec.atom) {
			atomDepth -= 1;
		}
		if (atomDepth === 0) return false;

		atom = $event.node(atomDepth);
		atomPos = $event.before(atomDepth);
	}

	const atomDom = view.nodeDOM(atomPos);
	const atomRect =
		atomDom instanceof HTMLElement ? atomDom.getBoundingClientRect() : null;
	const insertAfter = atomRect
		? atom.isInline
			? event.clientX >= atomRect.left + atomRect.width / 2
			: event.clientY >= atomRect.top + atomRect.height / 2
		: eventPos.pos > atomPos + atom.nodeSize / 2;
	const insertPos = insertAfter ? atomPos + atom.nodeSize : atomPos;

	const { from, to } = view.state.selection;
	if (moved && insertPos >= from && insertPos <= to) return true;

	const tr = view.state.tr;
	if (moved) tr.deleteSelection();

	const mappedInsertPos = tr.mapping.map(insertPos);
	const beforeInsert = tr.doc;
	const isNode =
		slice.openStart === 0 &&
		slice.openEnd === 0 &&
		slice.content.childCount === 1;

	if (isNode) {
		tr.replaceRangeWith(
			mappedInsertPos,
			mappedInsertPos,
			slice.content.firstChild as NonNullable<typeof slice.content.firstChild>,
		);
	} else {
		tr.replaceRange(mappedInsertPos, mappedInsertPos, slice);
	}
	if (tr.doc.eq(beforeInsert)) return true;

	const selectionPos = Math.min(
		tr.doc.content.size,
		mappedInsertPos + slice.size,
	);
	tr.setSelection(Selection.near(tr.doc.resolve(selectionPos)));
	view.focus();
	view.dispatch(tr.setMeta("uiEvent", "drop"));
	return true;
}

export const useEditor = ({
	ref,
	disabled,
}: {
	ref: RefObject<HTMLDivElement | null>;
	disabled?: boolean;
}) => {
	const client = useContext(ClientContext);

	const { upload } = useUploads();
	const { sendMessage } = useMessaging();

	const [isMultiline, setMultiline] = useState(false);

	// Ctrl or Cmd with Shift and V pastes plain text. Where the webview binds
	// it, a paste follows the keys and is taken as plain; where nothing does,
	// the clipboard is read for it instead once the paste has not come.
	const plainPaste = useRef(false);

	const editor = _useEditor({
		editorProps: {
			handleDrop: dropOutsideAtom,
			handlePaste: (_view, event): boolean => {
				if (plainPaste.current) {
					plainPaste.current = false;
					const text = event.clipboardData?.getData("text/plain");
					if (text) return EditorUtils.insertPlain(text);
				}

				let uploaded = false;
				for (const item of event.clipboardData?.items ?? []) {
					if (item.kind === "file") {
						const file = item.getAsFile();
						if (file) {
							upload.mutate({ kind: "ATTACHMENT", file });
							uploaded = true;
						}
					}
				}
				if (uploaded) return true;

				const text = event.clipboardData?.getData("text/plain");
				return text ? EditorUtils.insertPasted(text) : false;
			},
			handleKeyDown: (_view, event) => {
				if (
					event.code === "KeyV" &&
					event.shiftKey &&
					(event.ctrlKey || event.metaKey) &&
					!event.altKey
				) {
					plainPaste.current = true;
					setTimeout(() => {
						if (!plainPaste.current) return;
						plainPaste.current = false;
						navigator.clipboard
							?.readText()
							.then((text) => text && EditorUtils.insertPlain(text))
							.catch((error) =>
								console.warn("[useEditor] couldn't read the clipboard", error),
							);
					}, PLAIN_PASTE_WINDOW);
					return false;
				}
				if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
					if (event.shiftKey) {
						console.log(editor.getJSON());
						console.log(editor.getMarkdown());
						console.log(EditorUtils.getData(editor));
						return;
					}
					void sendMessage.mutate();
					return true;
				}
			},
		},
		extensions: [
			StarterKit.configure({
				document: false,
				link: false,
				blockquote: false,
				codeBlock: false,
				hardBreak: false,
			}),
			EnterKeymap,
			Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
			useDocument(),
			useLink(),
			useBlockquote(),
			useCodeBlock(),
			usePaste(),
			useAttachment(),
			useCommand(),
			usePlaceholder(),
		],
		coreExtensionOptions: {
			clipboardTextSerializer: {
				blockSeparator: "\n",
			},
		},
		onCreate: ({ editor }) => {
			const markdown = editor.storage.markdown.manager as unknown as {
				encodeTextForMarkdown: unknown;
				codeTypes: { has: (_: unknown) => boolean };
				escapeMarkdownSyntax: (_: string) => string;
				parse: (markdown: string) => JSONContent;
			};
			const parseMarkdown = markdown.parse.bind(markdown);
			markdown.parse = (source) =>
				parseMarkdown(MarkdownUtils.normalize(source));

			markdown.encodeTextForMarkdown = function (
				text: string,
				node: JSONContent,
				parentNode?: JSONContent,
			) {
				const isInsideCode =
					(parentNode?.type != null && this.codeTypes.has(parentNode.type)) ||
					(node.marks ?? []).some((mark) =>
						this.codeTypes.has(typeof mark === "string" ? mark : mark.type),
					);

				if (isInsideCode) {
					return text;
				}

				return this.escapeMarkdownSyntax(text);
			};
		},
		onUpdate: ({ editor }) => {
			if (editor.isEmpty) setMultiline(false);
			useEditorStore.getState().update({ client });
		},
	});

	useEffect(() => {
		useEditorStore.setState({ editor });
		return () => {
			if (useEditorStore.getState().editor === editor) {
				useEditorStore.setState({ editor: null });
			}
		};
	}, [editor]);

	useLayoutEffect(() => {
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			const height = entry.contentRect.height;
			if (height > 40) setMultiline(true);
		});
		if (ref.current) {
			observer.observe(ref.current);
		}
		return () => observer.disconnect();
	}, [ref]);

	useEffect(() => {
		editor.setEditable(!disabled, false);
	}, [editor, disabled]);

	useHotkeys([
		["/", () => editor.commands.focus()],
		["mod+/", () => editor.commands.focus()],
	]);

	return { editor, isMultiline };
};
