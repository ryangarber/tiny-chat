import { useContext, useEffect, useEffectEvent } from "react";
import {
	FindScopeContext,
	useFindSegments,
} from "#client/features/find/hooks/useFindScope.ts";
import { FindTextService } from "#client/features/find/services/FindTextService.ts";
import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import { useMessageStore } from "#client/features/message/stores/useMessageStore.ts";
import type { MessageState } from "#core/features/data/types/message.ts";

/**
 * Makes a list of messages searchable whether or not each is drawn, for the
 * segmented scope it is drawn in: inside a `MessageProvider`, for the toolsets
 * its tool calls are read with.
 *
 * `onReveal` is called with the message find wants drawn, each time it asks,
 * for a virtualized list to scroll to while that message is not drawn.
 */
export const useFindMessages = (
	messages: MessageState[],
	onReveal: (id: string) => void,
) => {
	const toolsets = useMessageStore((state) => state.toolsets);
	useFindSegments(() => FindTextService.messages(messages, toolsets));

	const scope = useContext(FindScopeContext);
	const revealed = useFindStore((state) =>
		state.revealed?.scope === scope ? state.revealed : null,
	);
	const reveal = useEffectEvent((key: string) => {
		const message = FindTextService.messageOf(messages, key);
		if (message) onReveal(message.id);
	});
	useEffect(() => {
		if (revealed) reveal(revealed.key);
	}, [revealed]);
};
