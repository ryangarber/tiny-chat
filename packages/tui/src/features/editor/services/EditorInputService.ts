import { TextareaUtils } from "better-ink-ui";
import type { ClientInput } from "#client/features/editor/services/ComposerService.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";
import {
	insertNode,
	useEditorStore,
} from "#tui/features/editor/stores/useEditorStore.ts";

/**
 * The terminal editor as the client's `input`, for whichever host runs it.
 *
 * The editor holds its commands, attachments and long pastes as atoms — short
 * stand-ins for the parts they travel as — which are cut back out here, and
 * written back in when a message is loaded for editing.
 */
export const EditorInputService = {
	getData: () => {
		const { content } = useEditorStore.getState();
		return [AtomUtils.toData({ content })];
	},
	getText: () => useEditorStore.getState().content,
	setData: ({ data }) => {
		const content = AtomUtils.fromData(data);
		useEditorStore.setState({
			content,
			cursor: TextareaUtils.cursor(content, content.length),
			selection: null,
		});
	},
	insertNode: ({ node }) => insertNode(node),
} as const satisfies ClientInput;
