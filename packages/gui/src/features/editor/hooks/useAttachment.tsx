import { Text } from "@mantine/core";
import { PluginKey } from "@tiptap/pm/state";
import { Node, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import { useCallback, useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { useAttachments } from "#client/features/editor/hooks/useAttachments.ts";
import { AttachmentService } from "#client/features/editor/services/AttachmentService.ts";
import { useEditorPartStore } from "#client/features/editor/stores/useEditorPartStore.ts";
import type { AttachmentItem } from "#client/features/editor/types/attachment.ts";
import { AttachmentUtils } from "#client/features/editor/utils/AttachmentUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import {
	type CompletionGroup,
	renderCompletions,
} from "#gui/features/editor/components/Completions.tsx";
import { NodeUtils } from "#gui/features/editor/utils/NodeUtils.ts";
import AttachmentView from "#gui/features/part/components/Attachment.tsx";
import SourceChip from "#gui/features/part/components/SourceChip.tsx";

interface AttachmentGroup extends CompletionGroup<AttachmentItem> {
	items: AttachmentItem[];
}

interface AttachmentOptions {
	getAttachables: (
		query: string,
		signal?: AbortSignal,
	) => Promise<AttachmentGroup[]>;
	attach: (item: AttachmentItem) => Promise<string>;
}

const pluginKey = new PluginKey("attachment");

const Attachment = Node.create({
	name: "attachment",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	isolating: true,
	draggable: true,
	extendNodeSchema() {
		return { disableDropCursor: true };
	},
	addOptions(): AttachmentOptions {
		return {
			getAttachables: async () => [],
			attach: async () => "",
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
		return [{ tag: `attachment` }];
	},
	renderHTML({ HTMLAttributes }) {
		return ["attachment", HTMLAttributes];
	},
	addNodeView() {
		return ReactNodeViewRenderer(
			({ node }) => <AttachmentNodeView id={node.attrs.id} />,
			{ as: "attachment", attrs: ({ node }) => node.attrs },
		);
	},
	...NodeUtils.createPartMarker({ nodeName: "attachment" }),
	addProseMirrorPlugins() {
		return [
			Suggestion<AttachmentGroup, AttachmentItem>({
				editor: this.editor,
				char: "@",
				pluginKey,
				allowToIncludeChar: true,
				findSuggestionMatch: ({ $position }) => {
					const text =
						$position.nodeBefore?.isText && $position.nodeBefore.text;
					if (!text) return null;

					const match = AttachmentUtils.match(text);
					if (!match) return null;

					const textFrom = $position.pos - text.length;
					return {
						range: {
							from: textFrom + match.from,
							to: textFrom + match.to,
						},
						query: match.text,
						text: text.slice(match.from, match.to),
					};
				},
				placement: "top-start",
				items: async ({ query, signal }) => {
					const items = await (
						this.options as AttachmentOptions
					).getAttachables(query, signal);
					const other: AttachmentGroup = {
						name: "Other",
						items: [],
					};

					if (PathUtils.hostname(query)) {
						other.items.push({
							name: PathUtils.hostname(query),
							value: PathUtils.asWeb(query),
						});
					}

					return [...AttachmentUtils.filter({ groups: items, query }), other];
				},
				command: ({ editor, range, props }) => {
					void (this.options as AttachmentOptions).attach(props).then((id) => {
						editor
							.chain()
							.focus()
							.insertContentAt(range, [
								{ type: "text", text: " " },
								{ type: this.name, attrs: { id } },
								{ type: "text", text: " " },
							])
							.run();
					});
				},
				render: renderCompletions({
					renderEmpty: () => "No matches",
					renderItem: (item) => {
						return (
							<SourceChip
								path={item.value}
								directory={item.directory}
								miw={0}
								wrap="nowrap"
								viewable={false}
							>
								<Text
									size="sm"
									style={{
										overflow: "hidden",
										whiteSpace: "nowrap",
										textOverflow: "ellipsis",
									}}
								>{`${item.name}${item.directory ? "/" : ""}`}</Text>
							</SourceChip>
						);
					},
					onTab: ({ item, editor, range, query }) => {
						editor
							.chain()
							.focus()
							.insertContentAt(
								range,
								`@${AttachmentUtils.continued({ query, item })}`,
							)
							.run();
					},
				}),
			}),
		];
	},
});

export const useAttachment = () => {
	const client = useContext(ClientContext);
	const { getAttachables } = useAttachments();
	const attach = useCallback(
		async (item: AttachmentItem) =>
			(await AttachmentService.create({ client, item })).id,
		[client],
	);

	return useMemo(
		() =>
			Attachment.configure({
				getAttachables,
				attach,
			} satisfies AttachmentOptions),
		[getAttachables, attach],
	);
};

function AttachmentNodeView({ id }: { id: string }) {
	const attachment = useEditorPartStore((state) => state.parts[id]);
	if (attachment?.type !== "attachment") return null;
	return (
		<NodeViewWrapper as="span" contentEditable={false} data-drag-handle>
			<AttachmentView
				source={attachment.source}
				directory={attachment.content.type === "directory"}
				name={attachment.label}
				grabbable
			/>
		</NodeViewWrapper>
	);
}
