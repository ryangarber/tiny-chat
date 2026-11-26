import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useContext, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ClientContext } from "#client/client.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { ActiveChatUtils } from "#client/features/chat/utils/ActiveChatUtils.ts";
import { useSettings } from "#client/features/settings/hooks/useSettings.ts";
import type { zAgentChat } from "#core/features/agent/types/agent.ts";

export const useChat = () => {
	const client = useContext(ClientContext);

	const chatId = useChatStore((s) => s.active.chatId);
	const { temporary, incognito } = useChatStore(
		useShallow((s) => ActiveChatUtils.options(s.active)),
	);
	const project = useChatStore((s) => s.active.project);

	const chat = useQuery({
		queryKey: client.query.chat.getChat.queryKey({ id: chatId || undefined }),
		queryFn: async () => {
			if (!chatId) return null;
			const data = await client.api.chat.getChat.query(chatId).catch((e) => {
				// A deleted chat, or someone else's: leave for a new chat instead of
				// sitting on an id nothing can be sent to.
				if (!(e instanceof TRPCClientError) || e.data?.code !== "NOT_FOUND")
					throw e;
				if (useChatStore.getState().active.chatId === chatId)
					ChatService.setChat({ id: null });
				return null;
			});
			return data;
		},
		initialData: client.queryClient
			.getQueryData(
				client.query.chat.getChatList.infiniteQueryKey({ limit: 10 }),
			)
			?.pages.flatMap((page) => [
				...page.chats,
				...page.projects.flatMap((project) => project.chats),
			])
			.find((chat) => chat.id === chatId),
		enabled: !!chatId,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { settings: projectSettings } = useSettings({
		project: chatId ? null : project,
	});

	/**
	 * The chat the next message will belong to, whether or not it exists yet: the
	 * open chat, or a stand-in for the one that sending would create in the active
	 * project. This is what an agent build is described by, so the project's
	 * settings and the pending flags count before there is a row to read them off.
	 */
	const nextChat = useMemo((): zAgentChat => {
		if (chat.data) return chat.data;
		return {
			id: null,
			project: project
				? {
						title: null,
						settings: projectSettings.data ?? {},
					}
				: null,
			incognito,
			temporary,
		};
	}, [chat.data, project, projectSettings.data, incognito, temporary]);

	return { chat, nextChat };
};
