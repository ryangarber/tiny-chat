import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { PluginKey } from "@tiptap/pm/state";
import {
	type Editor,
	Node,
	NodeViewWrapper,
	type Range,
	ReactNodeViewRenderer,
} from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import { useMemo } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useCommands } from "#client/features/editor/hooks/useCommands.ts";
import {
	getEditorPart,
	useEditorPartStore,
} from "#client/features/editor/stores/useEditorPartStore.ts";
import type {
	CommandChoiceItem,
	CommandGroup,
	CommandItem,
} from "#client/features/editor/types/command.ts";
import type {
	CompletionGroup,
	CompletionItem,
} from "#client/features/editor/types/completion.ts";
import { CommandUtils } from "#client/features/editor/utils/CommandUtils.ts";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { AppService } from "#gui/core/services/AppService.ts";
import { renderCompletions } from "#gui/features/editor/components/Completions.tsx";
import { NodeUtils } from "#gui/features/editor/utils/NodeUtils.ts";
import CommandView from "#gui/features/part/components/Command.tsx";
import { useUpdate } from "#gui/features/update/hooks/useUpdate.ts";

interface CommandOptions {
	getCommands: () => CommandGroup[];
}

const nodeName = "command";
const pluginKey = new PluginKey("command");

/** The shared lists' lower-case wording, as the app's sentences are written. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A command is written as the text it is — its name, then a space and its
 * argument — the way it is in a plain buffer, and read with the same
 * {@link CommandUtils.match}, so typing a name and a space opens its choices
 * here just as it does in the terminal. Only once it is chosen does it become
 * a chip, which holds the command and its argument and is never edited.
 */
const Command = Node.create({
	name: nodeName,
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	draggable: false,
	addOptions(): CommandOptions {
		return {
			getCommands: () => [],
		};
	},
	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML(element) {
					return element.getAttribute("id");
				},
				renderHTML(attributes) {
					return { id: attributes.id };
				},
			},
		};
	},
	parseHTML() {
		return [{ tag: `command` }];
	},
	renderHTML({ HTMLAttributes }) {
		return ["command", HTMLAttributes];
	},
	addNodeView() {
		return ReactNodeViewRenderer(
			({ node }) => <CommandNodeView id={node.attrs.id} />,
			{ as: "command", attrs: ({ node }) => node.attrs },
		);
	},
	...NodeUtils.createPartMarker({ nodeName }),
	addProseMirrorPlugins() {
		const getCommands = () => (this.options as CommandOptions).getCommands();
		/** The command a suggestion's query, everything after its slash, is of. */
		const resolve = (query: string) =>
			CommandUtils.match({ line: `/${query}`, groups: getCommands() });

		return [
			Suggestion<CompletionGroup, CompletionItem>({
				editor: this.editor,
				char: "/",
				pluginKey,
				placement: "top-start",
				// Escape keeps the list closed until the cursor leaves the command,
				// even as its argument is typed on with spaces.
				allowSpaces: true,
				findSuggestionMatch: ({ $position }) => {
					const { text, start } = NodeUtils.textBefore($position);
					const match = CommandUtils.match({
						line: text,
						groups: getCommands(),
					});
					if (!match) return null;
					return {
						range: { from: start + match.from, to: start + match.to },
						query: text.slice(match.from + 1, match.to),
						text: text.slice(match.from, match.to),
					};
				},
				// A slash written as code is only ever the text it is.
				allow: ({ state, range }) => !NodeUtils.isInCode(state, range.from),
				items: async ({ editor, query }) => {
					const match = resolve(query);
					if (!match) return [];
					if (match.command) {
						return CommandUtils.filterChoices({
							command: match.command,
							query: match.text,
						});
					}
					return CommandUtils.filter({
						groups: getCommands(),
						query: match.text,
						used: getCommandNodes(editor).flatMap(({ node }) => {
							const value = getEditorPart("command", node.attrs.id)?.value;
							return value ? [value] : [];
						}),
					});
				},
				render: renderCompletions({
					tabs: true,
					getScope: (query) => resolve(query)?.command?.name ?? "",
					renderEmpty: ({ query }) =>
						sentence(CommandUtils.empty(resolve(query))),
					renderItem: (item, { query }) =>
						resolve(query)?.command ? item.name : `/${item.name}`,
					onTab: ({ item, editor, range, query }) => {
						const match = resolve(query);
						if (!match) return true;
						if (match.command) {
							applyChoice({
								editor,
								range,
								command: match.command,
								choice: item,
								complete: true,
							});
						} else {
							applyCommand({ editor, range, command: item, complete: true });
						}
						return true;
					},
					onEnterEmpty: ({ editor, range, query }) => {
						const command = resolve(query)?.command;
						if (!command) return false;
						return applyContent({
							editor,
							range,
							command,
							value: resolve(query)?.text ?? "",
						});
					},
				}),
				command: ({ editor, range, props }) => {
					const match = resolve(
						editor.state.doc
							.textBetween(range.from, range.to, undefined, "\uFFFC")
							.slice(1),
					);
					if (!match) return;
					if (match.command) {
						applyChoice({
							editor,
							range,
							command: match.command,
							choice: props,
						});
					} else {
						applyCommand({ editor, range, command: props });
					}
				},
			}),
		];
	},
});

export const useCommand = () => {
	const runtime = useRuntime();
	const { update, installUpdate } = useUpdate();

	const { getCommands } = useCommands({
		onOpenSettings: () => AppService.openSettings(),
		onOpenChats: () => AppService.openSidebar(),
		onOpenFiles: () => useLayoutStore.getState().setPanel("files", true),
		onOpenProjects: () => AppService.openSidebar(),
		onOpenConfig: () => AppService.openConfig(),
		onOpenUploads: () => AppService.openUploads("attachment"),
		onOpenGitHub: () => AppService.openUploads("github"),
		onOpenMemories: () => AppService.openMemories(),
		onOpenActions: () => AppService.openActions(),
		onOpenConsole: () => AppService.openConsole(),
		onQuit: runtime.quit && (() => void runtime.quit?.()),
		onLogin: () => AppService.openAccount(),
		onLogout: () => window.location.reload(),
		update: update.data
			? {
					version: update.data.version,
					install: () => update.data && installUpdate.mutate(update.data),
				}
			: undefined,
	});

	return useMemo(
		() => Command.configure({ getCommands } satisfies CommandOptions),
		[getCommands],
	);
};

function CommandNodeView({ id }: { id: string }) {
	const part = useEditorPartStore((state) => state.parts[id]);
	if (part?.type !== "command") return null;

	return (
		<NodeViewWrapper as="span" contentEditable={false}>
			<CommandView name={part.name} content={part.argument} />
		</NodeViewWrapper>
	);
}

/** Write a chip standing for a command, and its argument, over `range`. */
function insertNode({
	editor,
	range,
	command,
	value,
}: {
	editor: Editor;
	range: Range;
	command: CommandItem;
	value?: string;
}) {
	const node = CommandUtils.toNode({ command, value });
	editor
		.chain()
		.focus()
		.insertContentAt(range, [
			{ type: nodeName, attrs: { id: node.id } },
			{ type: "text", text: " " },
		])
		.run();
}

/** Replace `range` with plain text, the cursor after it. */
function write({
	editor,
	range,
	text,
}: {
	editor: Editor;
	range: Range;
	text: string;
}) {
	editor.chain().focus().insertContentAt(range, text).run();
}

/**
 * A command chosen from the list, as {@link CommandUtils.applyCommand} writes
 * one into a plain buffer: one taking an argument is written out with a space,
 * which opens its choices; otherwise it runs, or stands as a chip. `complete`
 * only writes out its name.
 */
function applyCommand({
	editor,
	range,
	command,
	complete,
}: {
	editor: Editor;
	range: Range;
	command: CommandItem;
	complete?: boolean;
}) {
	if (CommandUtils.acceptsContent(command)) {
		return write({ editor, range, text: `/${command.name} ` });
	}
	if (complete) return write({ editor, range, text: `/${command.name}` });
	if (CommandUtils.run({ command })) {
		editor.chain().focus().deleteRange(range).run();
		return;
	}
	insertNode({ editor, range, command });
}

/** A choice chosen from the list, as {@link CommandUtils.applyChoice} does. */
function applyChoice({
	editor,
	range,
	command,
	choice,
	complete,
}: {
	editor: Editor;
	range: Range;
	command: CommandItem;
	choice: CommandChoiceItem;
	complete?: boolean;
}) {
	if (complete) {
		return write({ editor, range, text: `/${command.name} ${choice.name}` });
	}
	if (CommandUtils.runChoice({ command, choice })) {
		editor.chain().focus().deleteRange(range).run();
		return;
	}
	insertNode({ editor, range, command, value: choice.name });
}

/** The argument typed out, as {@link CommandUtils.applyContent} takes it. */
function applyContent({
	editor,
	range,
	command,
	value: _value,
}: {
	editor: Editor;
	range: Range;
	command: CommandItem;
	value: string;
}) {
	// A chip the argument reaches over stands in its text as nothing.
	const value = _value.replaceAll("\uFFFC", "").trim();
	if (CommandUtils.run({ command, value })) {
		editor.chain().focus().deleteRange(range).run();
		return true;
	}
	if (!value || CommandUtils.needsRun(command)) return false;
	insertNode({ editor, range, command, value });
	return true;
}

/** The command extension's own options, which carry the command catalog. */
function getCommandOptions(editor: Editor) {
	return editor.extensionManager.extensions.find(
		(extension) => extension.name === nodeName,
	)?.options as CommandOptions | undefined;
}

function getCommandNodes(editor: Editor) {
	const nodes: {
		node: ProseMirrorNode;
		range: Range;
	}[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "command") {
			nodes.push({
				node,
				range: { from: pos, to: pos + node.nodeSize },
			});
		}
	});
	return nodes;
}

/**
 * Whether a command that acts on the client is still sitting in the editor
 * waiting to be run, which a message must not be sent over the top of.
 */
export function hasPendingCommandNode(editor: Editor) {
	const groups = getCommandOptions(editor)?.getCommands() ?? [];

	return getCommandNodes(editor).some(({ node }) => {
		const part = getEditorPart("command", node.attrs.id);
		const command = CommandUtils.find({ groups, name: part?.name });
		return !!command && CommandUtils.needsRun(command);
	});
}
