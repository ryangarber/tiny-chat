import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type { ChatState, ProjectLike } from "#core/features/data/types/chat.ts";

export const useChatList = () => {
	const client = useContext(ClientContext);

	const chatId = useChatStore((s) => s.active.chatId);

	const projects = useInfiniteQuery({
		...client.query.chat.getChatList.infiniteQueryOptions(
			{ limit: 10 },
			{
				getNextPageParam: (lastPage, _pages) => lastPage.nextCursor,
				staleTime: 600000,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
			},
		),
	});

	const renameChat = useMutation({
		mutationFn: async ({ chat, title }: { chat: ChatState; title: string }) => {
			await client.api.chat.setChatTitle.mutate({ chat, title });
		},
		onSuccess: () => ChatService.fetchChatList({ client }),
	});

	const moveChat = useMutation({
		mutationFn: ({
			chat,
			projectId,
		}: {
			chat: ChatState;
			projectId: string | null;
		}) => client.api.chat.setChatProject.mutate({ chat, projectId }),
		onSuccess: () => {
			client.workingDirectory.refresh();
			return ChatService.fetchChatList({ client });
		},
	});

	const deleteChat = useMutation({
		mutationFn: async ({ chat }: { chat: ChatState }) => {
			return client.api.chat.deleteChat.mutate(chat);
		},
		onSuccess: async (_, input) => {
			await ChatService.fetchChatList({ client });
			if (chatId === input.chat.id) ChatService.setChat({ id: null });
		},
	});

	const createProject = useMutation({
		mutationFn: () => client.api.chat.createProject.mutate(),
		onSuccess: () => ChatService.fetchChatList({ client }),
	});

	const updateProject = useMutation({
		mutationFn: ({ project, title }: { project: ProjectLike; title: string }) =>
			client.api.chat.updateProject.mutate({ project, title }),
		onSuccess: () => ChatService.fetchChatList({ client }),
	});

	const deleteProject = useMutation({
		mutationFn: ({
			project,
			deleteChats,
		}: {
			project: ProjectLike;
			deleteChats: boolean;
		}) => client.api.chat.deleteProject.mutate({ project, deleteChats }),
		onSuccess: () => {
			client.workingDirectory.refresh();
			return ChatService.fetchChatList({ client });
		},
	});

	return {
		projects,
		renameChat,
		moveChat,
		deleteChat,
		createProject,
		updateProject,
		deleteProject,
	};
};
