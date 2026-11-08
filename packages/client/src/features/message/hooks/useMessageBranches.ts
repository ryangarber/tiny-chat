import { useMutation } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { MessageQueryService } from "#client/features/message/services/MessageQueryService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";

export const useMessageBranches = (message: MessageState) => {
	const { messages } = useMessages();
	const client = useContext(ClientContext);
	const selection = useMutation({
		mutationFn: (id: string) =>
			MessageQueryService.selectBranch(client, message.previousId, id),
		onError: (error) =>
			console.error("[useMessageBranches] could not select branch:", error),
	});
	const options = messages.data?.branchOptions[message.id] ?? [];
	const index = options.indexOf(message.id);
	return {
		index,
		count: options.length,
		select: (offset: number) => {
			const id = options[index + offset];
			if (!id) return;
			ComposerService.cancel({ client });
			selection.mutate(id);
		},
	};
};
