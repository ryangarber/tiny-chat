import type { QueryFilters } from "@tanstack/react-query";
import type { Client } from "#client/client.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useSeenStore } from "#client/features/chat/stores/useSeenStore.ts";
import { ActiveChatUtils } from "#client/features/chat/utils/ActiveChatUtils.ts";
import type { MessageState } from "#core/features/data/types/message.ts";

/** A selected branch of a chat, whole, with the sibling options at each step. */
export type History = Awaited<
	ReturnType<Client["api"]["message"]["getMessages"]["query"]>
>;

const filtersOf = (client: Client, chat: string): QueryFilters => ({
	queryKey: client.query.message.getMessages.queryKey({ chat }),
});

/** Every cached history for a chat, best first: the longest. */
const cachedOf = (client: Client, chat: string) =>
	client.queryClient
		.getQueriesData<History>(filtersOf(client, chat))
		.map(([, data]) => data)
		.filter((data): data is History => !!data)
		.sort((a, b) => b.messages.length - a.messages.length);

/**
 * The one copy of a chat's messages: the whole selected branch, which the chat
 * renders, generation builds its context from, and estimates count. Histories
 * are long-lived and only change through {@link MessageQueryService.write} and
 * {@link MessageQueryService.selectBranch}, which move it a message at a time.
 */
export const MessageQueryService = {
	options: (
		client: Client,
		chat: string | null,
		branches: Record<string, string>,
	) =>
		client.query.message.getMessages.queryOptions(
			{ chat, branches },
			{
				enabled: !!chat,
				staleTime: Infinity,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
				// Another selection in the same chat stands in while one loads, so the
				// shared start of the conversation never blinks out.
				placeholderData: (data, query) => {
					const input = query?.queryKey[1] as
						| { input?: { chat?: string | null } }
						| undefined;
					return input?.input?.chat === chat ? data : undefined;
				},
			},
		),

	/** The selected history of the open chat, if it is cached. */
	getCurrent: (client: Client, chat: string) => {
		const branches = ActiveChatUtils.branches(
			useChatStore.getState().active,
			chat,
		);
		return client.queryClient.getQueryData(
			MessageQueryService.options(client, chat, branches).queryKey,
		);
	},

	/** The config of the last sent of `messages`, whatever their order. */
	getLastConfig: (messages: History["messages"]) => {
		const last = messages.reduce(
			(current, candidate) =>
				Temporal.PlainDateTime.compare(candidate.createdAt, current.createdAt) >
				0
					? candidate
					: current,
			messages[0],
		);
		return last?.config ?? null;
	},

	/** A selected history, from the cache unless it has gone stale. */
	ensure: (client: Client, chat: string, branches: Record<string, string>) =>
		client.queryClient.fetchQuery(
			MessageQueryService.options(client, chat, branches),
		),

	/** Install persisted content before changing the selected query key. */
	write: async (client: Client, message: MessageState, select = false) => {
		useSeenStore.getState().setLastSeen(message.chatId, Date.now());
		const filters = filtersOf(client, message.chatId);
		const queries = client.queryClient.getQueryCache().findAll(filters);
		// Let existing reads settle before writing, including an in-flight branch
		// switch. Cancelling that switch would strand its placeholder history.
		await Promise.allSettled(
			queries.flatMap((query) =>
				query.state.fetchStatus === "fetching" && query.promise
					? [query.promise]
					: [],
			),
		);
		const known = cachedOf(client, message.chatId).some((data) =>
			data.messages.some((m) => m.id === message.id),
		);
		// A write clears a query's invalidation, which is what has a history
		// cached before this message fetch it when next shown.
		const invalidated = queries.filter((query) => query.state.isInvalidated);
		client.queryClient.setQueriesData<History>(
			filters,
			(data) =>
				data && {
					messages: data.messages.map((m) =>
						m.id === message.id ? message : m,
					),
					branchOptions: Object.fromEntries(
						Object.entries(data.branchOptions).map(([id, siblings]) => {
							const sibling = data.messages.find((m) => m.id === id);
							return [
								id,
								sibling?.previousId === message.previousId &&
								!siblings.includes(message.id)
									? [...siblings, message.id]
									: siblings,
							];
						}),
					),
				},
		);
		for (const query of invalidated) query.invalidate();
		if (select && !known) {
			// Other cached selections may now have a new descendant. Mark them stale
			// without fetching; the selected path is populated below.
			await client.queryClient.invalidateQueries({
				...filters,
				refetchType: "none",
			});
		}
		const { active } = useChatStore.getState();
		if (!select || active.status !== "open" || active.chatId !== message.chatId)
			return;
		const data = MessageQueryService.getCurrent(client, message.chatId);
		const branches = {
			...active.branches,
			[message.previousId ?? ""]: message.id,
		};
		const target = MessageQueryService.options(client, active.chatId, branches);
		if (data) {
			const { messages } = data;
			const existing = messages.findIndex((m) => m.id === message.id);
			const parent = messages.findIndex((m) => m.id === message.previousId);
			const sibling = messages.findIndex(
				(m) => m.previousId === message.previousId,
			);
			if (
				existing >= 0 ||
				parent >= 0 ||
				sibling >= 0 ||
				!message.previousId ||
				!messages.length
			) {
				const prefix =
					existing >= 0
						? messages
						: [
								...messages.slice(
									0,
									parent >= 0 ? parent + 1 : Math.max(0, sibling),
								),
								message,
							];
				const branchOptions = { ...data.branchOptions };
				branchOptions[message.id] = branchOptions[message.id] ??
					(sibling >= 0 ? branchOptions[messages[sibling].id] : undefined) ?? [
						message.id,
					];
				client.queryClient.setQueryData(target.queryKey, {
					messages: prefix,
					branchOptions,
				});
			}
		}
		useChatStore.getState().selectBranch(message.previousId, message.id);
	},

	/**
	 * Switch the branch at `parentId`. Everything up to it is already held, so
	 * only what follows it is fetched, and the shared start keeps the very same
	 * message objects it had — nothing above the switch re-renders.
	 */
	selectBranch: (
		client: Client,
		parentId: string | null,
		messageId: string,
	) => {
		const { active } = useChatStore.getState();
		if (active.status !== "open") return Promise.resolve();
		const chat = active.chatId;
		const source =
			MessageQueryService.getCurrent(client, chat) ??
			cachedOf(client, chat).find((data) =>
				data.messages.some((m) => m.id === parentId),
			);
		const branches = { ...active.branches, [parentId ?? ""]: messageId };
		const options = MessageQueryService.options(client, chat, branches);
		const parent = source?.messages.findIndex((m) => m.id === parentId) ?? -1;
		const prefix =
			source && parent >= 0 ? source.messages.slice(0, parent + 1) : [];
		const cached = client.queryClient.getQueryState(options.queryKey);
		const loading = client.queryClient.fetchQuery({
			...options,
			staleTime: cached && !cached.isInvalidated ? Infinity : 0,
			queryFn: async ({ signal }) => {
				const after = prefix.length ? parentId : undefined;
				const page = await client.api.message.getMessages.query(
					{ chat, branches, after },
					{ signal },
				);
				const joins =
					!!after &&
					(!page.messages.length || page.messages[0].previousId === after);
				return {
					messages: joins ? [...prefix, ...page.messages] : page.messages,
					branchOptions: joins
						? {
								...Object.fromEntries(
									prefix.map((m) => [
										m.id,
										source?.branchOptions[m.id] ?? [m.id],
									]),
								),
								...page.branchOptions,
							}
						: page.branchOptions,
				};
			},
		});
		useChatStore.getState().selectBranch(parentId, messageId);
		return loading.then(() => undefined);
	},

	/** Mark a chat's histories stale, refetching the one on screen. */
	invalidate: async (client: Client, chat: string) => {
		await client.queryClient.invalidateQueries(filtersOf(client, chat));
	},
} as const;
