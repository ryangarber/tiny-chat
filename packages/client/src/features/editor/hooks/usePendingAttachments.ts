import { useContext, useEffect, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { useEditorPartStore } from "#client/features/editor/stores/useEditorPartStore.ts";

/**
 * Whether the message being written holds an attachment still being read,
 * which holds up sending it. Only chips in the document count: one taken out
 * keeps reading in the background without holding anything up.
 *
 * A read landing changes the part a chip points at but not the document, so
 * the message is read back out of the editor then, for everything else that
 * reads it (the token estimate, the send button) to see what it holds now.
 */
export const usePendingAttachments = () => {
	const client = useContext(ClientContext);
	const status = useEditorPartStore((state) => state.status);
	const data = useComposerStore((state) => state.data);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read whenever a read settles
	useEffect(() => {
		if (client.input) ComposerService.getData({ client });
	}, [client, status]);

	const pending = useMemo(
		() =>
			data
				.flat()
				.filter(
					(part) =>
						part.type === "attachment" && status[part.id]?.state === "pending",
				).length,
		[data, status],
	);

	return { pending };
};
