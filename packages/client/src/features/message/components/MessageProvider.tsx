import {
	createElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { StoreApi } from "zustand/vanilla";
import { ClientContext } from "#client/client.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import type { AgentStreamEvent } from "#client/core/services/StreamService.ts";
import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import { useSkills } from "#client/features/agent/hooks/useSkills.ts";
import { useStream } from "#client/features/agent/hooks/useStream.ts";
import { useSubagents } from "#client/features/agent/hooks/useSubagents.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { ClientMessageService } from "#client/features/agent/services/ClientMessageService.ts";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useChatFiles } from "#client/features/chat/hooks/useChatFiles.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import {
	createMessageStore,
	type MessageStore,
	MessageStoreContext,
} from "#client/features/message/stores/useMessageStore.ts";
import { useToolFeedbackStore } from "#client/features/part/stores/useToolFeedbackStore.ts";
import { useActions } from "#client/features/user/hooks/useActions.ts";
import { useMemories } from "#client/features/user/hooks/useMemories.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import {
	type Source,
	SourceUtils,
} from "#core/features/data/utils/SourceUtils.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

/**
 * Runs the chat-scoped queries and pushes the result into the store.
 *
 * It is deliberately a sibling of `children` rather than their parent: query
 * settling re-renders this component, which renders nothing, instead of the
 * whole message list.
 */
function MessageSync({ store }: { store: StoreApi<MessageStore> }) {
	const client = useContext(ClientContext);

	const { session } = useSession();
	const { chat } = useChat();
	const { toolsets, mcpTools, nativeTools } = useTools();
	const { skills, localSkills, nativeSkills } = useSkills();
	const { memories } = useMemories();
	const { actions } = useActions();
	const { providers } = useProviders();
	const { messages } = useMessages();
	const { chatFiles } = useChatFiles();
	const { subagents } = useSubagents();

	/**
	 * Hold everything back until the queries have settled, so a cold load
	 * publishes once instead of once per query.
	 *
	 * `isLoading` rather than `isPending`: a disabled query stays pending
	 * forever, which would never let the list through.
	 */
	const ready = ![
		session,
		chat,
		messages,
		memories,
		actions,
		providers,
		chatFiles,
		subagents,
		nativeTools,
		mcpTools,
		localSkills,
		nativeSkills,
	].some((query) => query.isLoading);

	const messageList = useMemo(
		() => messages.data?.messages ?? [],
		[messages.data],
	);

	const sources = useMemo((): Source[] => {
		return [
			// A subagent's run is read like a message, for what it touched.
			...[...messageList, ...(subagents.data ?? [])].flatMap((message) =>
				SourceUtils.find({ toolsets, message }),
			),
			...(memories.data?.map(
				(memory): Source => ({
					key: memory.id,
					type: "memory",
					value: memory,
				}),
			) ?? []),
			...(actions.data?.map(
				(action): Source => ({
					key: action.id,
					type: "action",
					value: action,
				}),
			) ?? []),
			...(chatFiles.data?.map(
				(file): Source => ({
					key: file.uri,
					type: "file",
					value: {
						path: file.uri,
						directory: file.isDirectory,
					},
				}),
			) ?? []),
		];
	}, [
		messageList,
		subagents.data,
		toolsets,
		actions.data,
		chatFiles.data,
		memories.data,
	]);

	/**
	 * A message is stale when an earlier message carries a newer timestamp, which
	 * means the chat was edited above it. Editing creates a sibling with a fresh
	 * `createdAt` and clones the descendants with their original timestamps, so
	 * user edits count too. Generation rewrites a message in place and bumps
	 * `updatedAt`, so a regenerated reply is current again. Tracking the newest
	 * timestamp seen so far settles the whole list in one pass.
	 */
	const staleIds = useMemo(() => {
		const stale = new Set<string>();
		let newestPrior = -Infinity;

		for (const message of messageList) {
			const touchedAt = (
				message.updatedAt ?? message.createdAt
			).toZonedDateTime("UTC").epochMilliseconds;
			if (newestPrior > touchedAt) stale.add(message.id);
			if (touchedAt > newestPrior) newestPrior = touchedAt;
		}

		return stale;
	}, [messageList]);

	// The reply being generated is read as it streams, not as last saved, so
	// its calls can be answered while the generation is still going.
	const streamKey = useStreamStore((state) =>
		chat.data ? state.chatAgentStreams.get(chat.data.id) : undefined,
	);
	const streamed = useStream<AgentStreamEvent>(streamKey ?? "")?.items.at(-1);
	const answered = useToolFeedbackStore((state) => state.answered);

	/** Calls in `data` waiting on the user. */
	const getPending = useCallback(
		(data: MessageState["data"]) =>
			DataUtils.getRenderedParts(data)
				.filter(
					(part) =>
						part.type === "toolCall" &&
						!answered.has(part.id) &&
						// As the call shows itself, so a call asking the user
						// something without a tool of Tiny Chat's behind it counts.
						ToolCallUtils.getState({
							part,
							tool: ToolUtils.find({ toolsets, part }).tool,
						}) === "feedback",
				)
				.map((part) => part.id),
		[answered, toolsets],
	);

	// Saved messages are scanned once per change, the streaming one per flush.
	const savedPending = useMemo(
		() =>
			messageList.map((message) => ({
				id: message.id,
				ids: getPending(message.data),
			})),
		[messageList, getPending],
	);
	const streamedPending = useMemo(
		() => (streamed ? getPending(streamed.data) : undefined),
		[streamed, getPending],
	);

	const { pendingFeedbackIds, nextFeedbackId } = useMemo(() => {
		const pendingFeedbackIds = savedPending.flatMap(({ id, ids }) =>
			streamedPending && id === streamKey ? streamedPending : ids,
		);
		return { pendingFeedbackIds, nextFeedbackId: pendingFeedbackIds[0] };
	}, [savedPending, streamedPending, streamKey]);

	const retry = useCallback(
		(message: MessageState) => {
			if (!session.data || !chat.data || !providers.data) return;
			void ClientMessageService.onMessage({
				client,
				user: session.data.user,
				message,
				chat: chat.data,
				providers: providers.data,
				skills,
				mcpTools: mcpTools.data ?? [],
			});
		},
		[session.data, chat.data, providers.data, mcpTools.data, skills, client],
	);

	const resume = useCallback(
		(message: MessageState) => {
			if (!session.data || !chat.data || !providers.data) return;
			void ClientMessageService.onMessage({
				client,
				user: session.data.user,
				message,
				chat: chat.data,
				providers: providers.data,
				skills,
				mcpTools: mcpTools.data ?? [],
				// No new results: the reply is kept as it is, and generation picks
				// up after it rather than starting it over.
				toolResults: [],
				resume: true,
			});
		},
		[session.data, chat.data, providers.data, mcpTools.data, skills, client],
	);

	useEffect(() => {
		if (!ready) return;
		store.getState().publish({
			ready,
			sources,
			toolsets,
			staleIds,
			pendingFeedbackIds,
			nextFeedbackId,
			regenerate: retry,
			resume,
		});
	}, [
		store,
		ready,
		sources,
		toolsets,
		staleIds,
		pendingFeedbackIds,
		nextFeedbackId,
		retry,
		resume,
	]);

	return null;
}

export function MessageProvider({ children }: { children: ReactNode }) {
	const [store] = useState(createMessageStore);

	return createElement(
		MessageStoreContext,
		{ value: store },
		createElement(MessageSync, { store, key: "sync" }),
		children,
	);
}
