import type { Client } from "#client/client.ts";
import { createChatShellCapability } from "#client/core/capabilities/createChatShellCapability.ts";
import { ClientBrowserService } from "#client/features/agent/services/ClientBrowserService.ts";
import { useEditorPartStore } from "#client/features/editor/stores/useEditorPartStore.ts";
import type { AttachmentItem } from "#client/features/editor/types/attachment.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { EditorNodeUtils } from "#client/features/editor/utils/EditorNodeUtils.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zData } from "#core/features/data/types/part.ts";
import { AttachmentService as CoreAttachmentService } from "#core/features/file/services/AttachmentService.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/** Reads still running, by the id of the chip standing for each. */
const reads = new Map<string, Promise<void>>();

const build = async ({
	client,
	item,
}: {
	client: Client;
	item: AttachmentItem;
}) => {
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

	return CoreAttachmentService.build({
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
		browser: (tab) => ClientBrowserService.readTab({ client, tab }),
		computer: client.computer,
	});
};

export const AttachmentService = {
	/**
	 * Stand an attachment in the editor at once, and read it in the
	 * background.
	 *
	 * The node points at a placeholder part marked `pending` until the read
	 * lands, when the built part takes its place under the same id — whether
	 * or not the chip is still in the document, so taking it out and putting it
	 * back (undo, cut and paste) never starts over. A read that fails leaves
	 * the placeholder, marked `failed` with why: sent like that, the model is
	 * told the attachment was unavailable.
	 */
	create: ({
		client,
		item,
	}: {
		client: Client;
		item: AttachmentItem;
	}): EditorNode => {
		const id = CommonUtils.getRandomId();
		const label = item.label ?? item.name;
		const node = EditorNodeUtils.create({
			...CoreAttachmentService.unavailable({ source: item.value, label }),
			id,
			// Drawn as a folder while it is read, as it will be once it is.
			...(item.directory ? { content: { type: "directory", items: [] } } : {}),
		});

		const { setStatus, addPart } = useEditorPartStore.getState();
		setStatus(id, { state: "pending" });

		const read = build({ client, item })
			.then((attachment) => {
				addPart({ ...attachment, id });
				setStatus(id, null);
			})
			.catch((error) => {
				console.warn("[AttachmentService] failed to read", item.value, error);
				// Back to the bare placeholder, as `unavailable`.
				addPart({
					...CoreAttachmentService.unavailable({ source: item.value, label }),
					id,
				});
				setStatus(id, {
					state: "failed",
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => reads.delete(id));
		reads.set(id, read);

		return node;
	},

	/** Settles once the attachment under `id` is read, or has failed to be. */
	ready: (id: string) => reads.get(id) ?? Promise.resolve(),

	/** The attachments in `data` still being read, which hold up sending it. */
	pending: (data: zData) => {
		const { status } = useEditorPartStore.getState();
		return data
			.flat()
			.filter(
				(part) =>
					part.type === "attachment" && status[part.id]?.state === "pending",
			);
	},
} as const;
