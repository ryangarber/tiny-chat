import type { Client } from "#client/client.ts";
import { useConfigStore } from "#client/features/agent/stores/useConfigStore.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { AttachmentService } from "#client/features/editor/services/AttachmentService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import type { AttachmentItem } from "#client/features/editor/types/attachment.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { AttachmentUtils } from "#client/features/editor/utils/AttachmentUtils.ts";
import { EditorNodeUtils } from "#client/features/editor/utils/EditorNodeUtils.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData } from "#core/features/data/types/part.ts";

export interface ClientInput {
	getData: ({ client }: { client: Client }) => zData;
	/**
	 * What the editor holds as the plain text it was typed as, with nothing
	 * escaped for Markdown: a shell command is read from here.
	 */
	getText: ({ client }: { client: Client }) => string;
	setData: ({ client, data }: { client: Client; data: zData }) => void;
	/**
	 * Write an attachment into the editor wherever the cursor is, as whatever
	 * stands for one there — a node, or an atom in a plain text buffer.
	 *
	 * Attachment nodes point at an already-built attachment part in the shared
	 * editor registry.
	 */
	insertNode: ({ client, node }: { client: Client; node: EditorNode }) => void;
}

/** The message being written: its content in the editor, and what sending it does. */
export const ComposerService = {
	/**
	 * Reads the message being written back out of the editor, as `zData`, and
	 * keeps {@link useComposerStore} in step with it — the one place every
	 * reader of the current content, in either runtime, can trust.
	 */
	getData: ({ client }: { client: Client }): zData => {
		if (!client.input) throw new Error("missing client input");

		const data = client.input
			.getData({ client })
			.map((step) =>
				step.filter((part) => part.type !== "text" || part.value.length),
			);
		useComposerStore.getState().setData(data);
		useComposerStore.getState().setText(client.input.getText({ client }));
		return data;
	},

	setData: ({ client, data }: { client: Client; data: zData }) => {
		if (!client.input) throw new Error("missing client input");

		client.input.setData({ client, data });
		useComposerStore.getState().setData(data);
	},

	insertAttachment: async ({
		client,
		item,
	}: {
		client: Client;
		item: AttachmentItem;
	}) => {
		if (!client.input) throw new Error("missing client input");
		const node = await AttachmentService.create({ client, item });
		client.input.insertNode({ client, node });
	},

	/** Quote a passage of a message into the message being written. */
	insertQuote: ({
		client,
		model,
		text,
	}: {
		client: Client;
		model: string;
		text: string;
	}) => {
		if (!client.input) throw new Error("missing client input");
		client.input.insertNode({
			client,
			node: EditorNodeUtils.quote({ model, text }),
		});
	},

	/**
	 * Attach an upload to the message being written, by referencing its
	 * directory on the chat mount. That reference is the whole of it: an upload
	 * is in a chat because a message points into it.
	 */
	attachUpload: async ({
		client,
		upload,
		file,
	}: {
		client: Client;
		upload: { id: string; name: string };
		file?: string;
	}) => {
		await ComposerService.insertAttachment({
			client,
			item: AttachmentUtils.forUpload({ upload, file }),
		});
	},

	/** Loads a message into the editor to replace it, with the config it was sent with. */
	edit: ({ client, message }: { client: Client; message: MessageState }) => {
		ComposerService.cancel({ client });
		useComposerStore.getState().edit(message);
		ComposerService.setData({ client, data: message.data });
		useConfigStore.getState().setOverrideConfig(message.config);
	},

	insertAfter: ({
		client,
		message,
	}: {
		client: Client;
		message: MessageState;
	}) => {
		ComposerService.cancel({ client });
		useComposerStore.getState().insertAfter(message);
	},

	/**
	 * Goes back to writing at the end of the branch. An edit's text goes with
	 * it and the chat's config comes back; a draft written while inserting stays.
	 */
	cancel: ({ client }: { client: Client }) => {
		const { mode, write } = useComposerStore.getState();
		if (mode.kind === "write") return;
		write();
		if (mode.kind !== "edit") return;
		ComposerService.setData({ client, data: [] });
		useConfigStore
			.getState()
			.setSyncChatId(useChatStore.getState().active.chatId);
	},

	/** Clears the editor once what it held has been sent. */
	reset: ({ client }: { client: Client }) => {
		useComposerStore.getState().write();
		ComposerService.setData({ client, data: [] });
	},
} as const;
