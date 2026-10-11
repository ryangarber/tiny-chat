import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { usePanel } from "#tui/core/components/Panel.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useSentinel } from "#tui/core/hooks/useSentinel.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import Completions from "#tui/features/editor/components/Completions.tsx";

export default function ChatList({
	fill = false,
}: {
	/** Drawn as a sidebar, taking the full height it is given. */
	fill?: boolean;
}) {
	const { projects, deleteChat } = useChatList();
	useWorkingStatus(projects, deleteChat);

	const project = useChatStore((state) => state.active.project);
	const chats =
		projects.data?.pages.flatMap((page) =>
			project
				? page.projects
						.filter((other) => project.id === other.id)
						.flatMap((other) => other.chats)
				: page.chats,
		) ?? [];

	// Older chats are appended below the list, so reaching the bottom is what
	// asks for the next page.
	const fetchOlder = useSentinel(projects);

	const { focused } = usePanel();
	const closePanel = useAppStore((state) => state.closePanel);
	const { setPage } = usePage({
		active: focused,
		onBack: () => {
			closePanel("chats");
			return false;
		},
	});

	return (
		<Completions
			fill={fill}
			itemProps={
				fill ? { flexGrow: 1, minWidth: 0, wrap: "truncate-end" } : undefined
			}
			groups={[
				{
					items: chats.map((chat) => ({
						name: chat.title || "Untitled",
						value: chat.id,
					})),
				},
			]}
			bindings={{
				primary: {
					name: "open",
					run: (item) => {
						ChatService.setChat({ id: item.value });
						setPage("chat");
					},
				},
				create: {
					name: "new chat",
					run: () => {
						ChatService.newChat(project ?? null);
						setPage("chat");
					},
				},
				remove: {
					name: "delete",
					run: (item) => {
						const chat = chats.find((chat) => chat.id === item.value);
						if (chat) deleteChat.mutate({ chat });
					},
				},
			}}
			renderEmpty={() => "nothing here yet"}
			actions={["back"]}
			selectFirstOnChange={false}
			onReachBottom={project ? undefined : fetchOlder}
		/>
	);
}
