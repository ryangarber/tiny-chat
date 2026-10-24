import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import {
	type Editor,
	Node,
	NodeViewContent,
	NodeViewWrapper,
	type Range,
	ReactNodeViewRenderer,
} from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import { useMemo } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useCommands } from "#client/features/editor/hooks/useCommands.ts";
import { useCompletionStore } from "#client/features/editor/stores/useCompletionStore.ts";
import {
	getEditorPart,
	useEditorPartStore,
} from "#client/features/editor/stores/useEditorPartStore.ts";
import type {
	CommandChoiceGroup,
	CommandChoiceItem,
	CommandGroup,
	CommandItem,
} from "#client/features/editor/types/command.ts";
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
const pluginKeyChoices = new PluginKey("command-choices");

const Command = Node.create({
	name: nodeName,
	group: "inline",
	content: "inline*",
	inline: true,
	isolating: false,
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
		return ["command", HTMLAttributes, 0];
	},
	addNodeView() {
		return ReactNodeViewRenderer(
			({ node, editor }) => (
				<CommandNodeView id={node.attrs.id} editor={editor} />
			),
			{ as: "command", attrs: ({ node }) => node.attrs },
		);
	},
	...NodeUtils.createPartMarker({
		nodeName,
		getContent: (part) => (part.type === "command" ? part.argument : undefined),
	}),
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey("command-sync"),
				// The chip's content is where an argument is typed, but the part is
				// where it is kept: the document only ever carries the pointer, so
				// what was typed has to be written back after every change.
				appendTransaction: (transactions, _oldState, newState) => {
					const docChanged = transactions.some(
						(transaction) => transaction.docChanged,
					);
					if (!docChanged) return null;

					const { addPart } = useEditorPartStore.getState();
					const groups = (this.options as CommandOptions).getCommands();

					let tr: Transaction | null = null;
					newState.doc.descendants((node, pos) => {
						if (node.type.name !== nodeName) return true;

						const part = getEditorPart("command", node.attrs.id);
						if (!part) return true;

						const command = CommandUtils.find({ groups, name: part.name });
						if (command && CommandUtils.acceptsContent(command)) {
							// Emptied down to the zero-width padding, which is the chip
							// having been deleted rather than an empty argument.
							if (node.textContent.length <= 1) {
								if (!tr) tr = newState.tr;
								tr.deleteRange(pos, pos + node.nodeSize);
								return true;
							}

							const argument = node.textContent.replace(/\u200B/g, "");
							if ((part.argument ?? "") !== argument) {
								addPart({ ...part, argument: argument || undefined });
							}
						}

						return true;
					});

					return tr;
				},
			}),
			Suggestion<CommandGroup, CommandItem>({
				editor: this.editor,
				char: "/",
				pluginKey,
				placement: "top-start",
				allow: ({ editor }) => {
					const { command } = getSelectedCommandNode(
						editor,
						(this.options as CommandOptions).getCommands(),
					);
					return command?.choices === undefined;
				},
				items: async ({ editor, query }) =>
					CommandUtils.filter({
						groups: (this.options as CommandOptions).getCommands(),
						query,
						used: getCommandNodes(editor).flatMap(({ node }) => {
							const value = getEditorPart("command", node.attrs.id)?.value;
							return value ? [value] : [];
						}),
					}),
				render: renderCompletions({
					renderEmpty: () => "No matches",
					renderItem: (item) => `/${item.name}`,
					onTab: ({ item, editor, range }) => {
						editor
							.chain()
							.focus()
							.insertContentAt(range, `/${item.name}`)
							.run();
						return true;
					},
				}),
				command: ({ editor, props, range }) => {
					applyCommand(editor, props, range);
				},
			}),
			Suggestion<CommandChoiceGroup, CommandChoiceItem>({
				editor: this.editor,
				char: "\u200B",
				pluginKey: pluginKeyChoices,
				placement: "top-start",
				allow: ({ editor }) => {
					const { command } = getSelectedCommandNode(
						editor,
						(this.options as CommandOptions).getCommands(),
					);
					return command?.choices !== undefined;
				},
				items: async ({ editor, query }) => {
					const { command } = getSelectedCommandNode(
						editor,
						(this.options as CommandOptions).getCommands(),
					);
					return CommandUtils.filterChoices({
						command,
						query: query.replaceAll("\u200B", ""),
					});
				},
				render: renderCompletions({
					renderEmpty: () => "No matches",
					renderItem: (item) => item.name,
					onTab: ({ item, editor, range }) => {
						editor
							.chain()
							.focus()
							.insertContentAt(range, `\u200B${item.name}\u200B`)
							.setTextSelection(range.from + 1 + (item.name?.length ?? 0))
							.run();
						return true;
					},
				}),
				command: ({ editor, props }) => {
					const { command } = getSelectedCommandNode(
						editor,
						(this.options as CommandOptions).getCommands(),
					);
					if (!command) {
						return;
					}

					if (CommandUtils.runChoice({ command, choice: props })) {
						editor.chain().focus().deleteNode(nodeName).run();
					}
					// TODO - apply choice value?
				},
			}),
		];
	},
	addKeyboardShortcuts() {
		return {
			Enter: () => {
				const { command, commandNode } = getSelectedCommandNode(
					this.editor,
					(this.options as CommandOptions).getCommands(),
				);
				if (!command || !commandNode) {
					return false;
				}

				const { isCompletionsOpen, isCompletionsEmpty } =
					useCompletionStore.getState();
				if (isCompletionsOpen && !isCompletionsEmpty) {
					return false;
				}

				const value = commandNode.textContent.replace(/[\s\u200B]/g, "");
				if (!CommandUtils.run({ command, value })) {
					return false;
				}

				this.editor.chain().focus().deleteNode(nodeName).run();
				return true;
			},
			Space: () => {
				const range = this.editor.state.selection;
				if (range.from !== range.to) return false;

				const { isCompletionsOpen } = useCompletionStore.getState();
				if (!isCompletionsOpen) return false;

				const { node } = this.editor.state.doc.childBefore(range.to);
				const text = node?.textContent?.split(" ").at(-1);
				if (!text) return false;

				const commands = (this.options as CommandOptions)
					.getCommands()
					.flatMap((group) => group.items);
				const command = commands.find((command) => `/${command.name}` === text);
				if (!command) return false;

				applyCommand(this.editor, command, {
					from: range.to - 1 - text.length,
					to: range.to,
				});
				return true;
			},
		};
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

function CommandNodeView({ id, editor }: { id: string; editor: Editor }) {
	const part = useEditorPartStore((state) => state.parts[id]);
	const command =
		part?.type === "command"
			? CommandUtils.find({
					groups: getCommandOptions(editor)?.getCommands() ?? [],
					name: part.name,
				})
			: null;

	if (part?.type !== "command") return null;

	return (
		<NodeViewWrapper as="span">
			<CommandView
				name={part.name}
				content={
					command && CommandUtils.acceptsContent(command) ? (
						<NodeViewContent />
					) : undefined
				}
			/>
		</NodeViewWrapper>
	);
}

function applyCommand(editor: Editor, command: CommandItem, range: Range) {
	const nodes = getCommandNodes(editor);
	const end = nodes.at(-1)?.range.to ?? 0;
	const acceptsContent = CommandUtils.acceptsContent(command);
	const focus = end + (acceptsContent ? 3 : 6);

	if (!acceptsContent && CommandUtils.run({ command })) {
		editor.chain().focus().deleteRange(range).run();
		return;
	}

	const node = CommandUtils.toNode({ command });

	editor
		.chain()
		.focus()
		.deleteRange(range)
		.insertContentAt(end + 1, [
			{
				type: nodeName,
				attrs: { id: node.id },
				// awful hidden zero-width hack to fix prosemirror fuckery
				content: [{ type: "text", text: "\u200B\u200B" }],
			},
			{ type: "text", text: " " },
		])
		.setTextSelection({ from: focus, to: focus })
		.run();
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

function getSelectedCommandNode(editor: Editor, groups: CommandGroup[]) {
	const { $from } = editor.state.selection;
	let commandNode: ProseMirrorNode | null = null;
	for (let depth = $from.depth; depth >= 0; depth--) {
		const node = $from.node(depth);

		if (node.type.name === "command") {
			commandNode = node;
			break;
		}
	}
	const command = CommandUtils.find({
		groups,
		name: commandNode
			? (getEditorPart("command", commandNode.attrs.id)?.name ?? undefined)
			: undefined,
	});
	return { command, commandNode };
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
