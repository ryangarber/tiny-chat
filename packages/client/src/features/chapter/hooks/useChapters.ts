import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useStableValue } from "#client/core/hooks/useStableValue.ts";
import {
	type AgentStreamEvent,
	ToolStreamService,
} from "#client/core/services/StreamService.ts";
import { useStream } from "#client/features/agent/hooks/useStream.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import type { Chapter } from "#client/features/chapter/types/chapter.ts";
import { ChapterUtils } from "#client/features/chapter/utils/ChapterUtils.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { ExpandService } from "#client/features/part/services/ExpandService.ts";
import type { MessageState } from "#core/features/data/types/message.ts";

/** Which of `ids` have a stream open, kept current as streams start and end. */
const useLiveToolCalls = (ids: string[]): ReadonlySet<string> => {
	// By value, so a list read anew with the same calls keeps its subscriptions.
	const key = ids.join("\n");
	const subscribe = useCallback(
		(listener: () => void) => {
			const unsubscribes = (key ? key.split("\n") : []).map((id) =>
				ToolStreamService.subscribe(id, listener),
			);
			return () => {
				for (const unsubscribe of unsubscribes) unsubscribe();
			};
		},
		[key],
	);
	const snapshot = useCallback(
		() =>
			(key ? key.split("\n") : [])
				.filter((id) => ToolStreamService.get(id))
				.join("\n"),
		[key],
	);
	const live = useSyncExternalStore(subscribe, snapshot, snapshot);
	return useMemo(() => new Set(live ? live.split("\n") : []), [live]);
};

/**
 * The open chat as chapters: one for every message of the user's in its
 * selected branch, and one for every call in any message that is still going
 * — running with its output streaming, as a dev server started in the
 * background does until it exits, or waiting on the user.
 *
 * The reply being generated is read as it streams rather than as last saved,
 * so its calls show up as they start. Where each chapter sits is the
 * renderer's to work out; {@link ChapterUtils.getCurrent} finds the one being
 * read.
 */
export const useChapters = ({ messages }: { messages: MessageState[] }) => {
	const { chat } = useChat();
	const { toolsets } = useTools();

	const streamKey = useStreamStore((state) =>
		chat.data ? state.chatAgentStreams.get(chat.data.id) : undefined,
	);
	const streamed = useStream<AgentStreamEvent>(streamKey ?? "")?.items.at(-1);
	const list = useMemo(
		() =>
			streamed && streamKey
				? messages.map((message) =>
						message.id === streamKey
							? { ...message, data: streamed.data }
							: message,
					)
				: messages,
		[messages, streamed, streamKey],
	);

	const live = useLiveToolCalls(
		useMemo(() => ChapterUtils.getCandidates(list), [list]),
	);

	const chapters = useStableValue<Chapter[]>(
		useMemo(
			() => ChapterUtils.getChapters({ messages: list, toolsets, live }),
			[list, toolsets, live],
		),
		ChapterUtils.isSame,
	);

	return {
		chapters,
		/**
		 * Opens the way to a call and brings it into view, once the renderer
		 * has scrolled its message far enough in to draw it.
		 */
		focusToolCall: ExpandService.focusToolCall,
	};
};
