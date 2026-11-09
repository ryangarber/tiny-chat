import { useQuery } from "@tanstack/react-query";
import { useCallback, useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { sessionQueryKey, useSession } from "#client/core/hooks/useSession.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import type { ProjectLike } from "#core/features/data/types/chat.ts";
import { zSettings } from "#core/features/data/types/user.ts";

export const settingsQueryKey = ["useSettings", "settings"] as const;

export const useSettings = ({
	project,
}: {
	project?: ProjectLike | null;
} = {}) => {
	const client = useContext(ClientContext);

	const { session } = useSession();

	const projectId =
		project && typeof project === "object" ? project.id : project;

	const settings = useQuery({
		queryKey: [...settingsQueryKey, projectId],
		queryFn: async () => {
			return await client.api.settings.get.query({ project: projectId });
		},
		initialData: !projectId
			? zSettings.safeParse(session.data?.user?.settings).data
			: undefined,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
	});

	const applySettings = useCallback(
		(settings: zSettings) => {
			client.queryClient.setQueryData(
				[...settingsQueryKey, projectId],
				settings,
			);
			// Everything that runs as the user (capabilities, providers,
			// generation) reads settings off the session, so keep it in step.
			if (!projectId) {
				client.queryClient.setQueryData<typeof session.data>(
					sessionQueryKey,
					(old) => old && { ...old, user: { ...old.user, settings } },
				);
			} else {
				// Chats carry their folder's settings, which generation reads.
				void client.queryClient.invalidateQueries({
					queryKey: client.query.chat.getChat.pathKey(),
				});
				void ChatService.fetchChatList({ client });
			}
			void client.queryClient.invalidateQueries({
				queryKey: client.query.memory.getChatMemoryIds.pathKey(),
			});
			return true;
		},
		[client, projectId],
	);

	return { settings, applySettings };
};
