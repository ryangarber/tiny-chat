import type { Client } from "#client/client.ts";
import { createChatShellCapability } from "#client/core/capabilities/createChatShellCapability.ts";
import type { AttachmentItem } from "#client/features/editor/types/attachment.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { EditorNodeUtils } from "#client/features/editor/utils/EditorNodeUtils.ts";
import { AttachmentService as CoreAttachmentService } from "#core/features/file/services/AttachmentService.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

export const AttachmentService = {
	create: async ({
		client,
		item,
	}: {
		client: Client;
		item: AttachmentItem;
	}): Promise<EditorNode> => {
		const source = item.value;
		const mounted = PathUtils.fromMount({ path: source });
		const shell =
			mounted?.mount && mounted.id
				? await createChatShellCapability({
						client,
						...(mounted.mount === "chat" ? { chat: mounted.id } : {}),
						...(mounted.mount === "uploads" ? { uploads: [mounted.id] } : {}),
						...(mounted.mount === "skills" ? { skills: [mounted.id] } : {}),
					})
				: client.shell;

		const attachment = await CoreAttachmentService.build({
			source,
			label: item.label ?? item.name,
			directory: item.directory,
			shell,
			web: {
				view: async ({ url }) => await client.api.web.view.query({ url }),
			},
			chat: async (id) => {
				const [chat, { messages }] = await Promise.all([
					client.api.chat.getChat.query(id),
					client.api.message.getMessages.query({ chat: id }),
				]);
				return { title: chat.title, messages };
			},
		});
		return EditorNodeUtils.create(attachment);
	},
} as const;
