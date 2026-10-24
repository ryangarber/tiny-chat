import { useMemo } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import type {
	GetStartedTarget,
	GetStartedWidget,
} from "#client/features/chat/types/getStarted.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { ChatUtils } from "#core/features/data/utils/ChatUtils.ts";

/** Links each widget shows, from the top of the chat list. */
const LIMIT = 3;

const ago = (timestamp: number) =>
	CommonUtils.formatDate({ date: new Date(timestamp), relative: true });

/**
 * What the new chat page offers to get started with, as widgets both runtimes
 * draw. A widget with nothing to show is left out.
 */
export const useGetStarted = () => {
	const { projects } = useChatList();
	const page = projects.data?.pages[0];
	const setPanel = useLayoutStore((state) => state.setPanel);

	const widgets = useMemo((): GetStartedWidget[] => {
		if (!page) return [];
		const widgets: GetStartedWidget[] = [];

		// Both lists come most recently active first.
		const recentProjects = page.projects.slice(0, LIMIT);
		if (recentProjects.length) {
			widgets.push({
				id: "projects",
				title: "Continue working on...",
				blocks: [
					{
						type: "links",
						links: recentProjects.map((project) => ({
							label: project.title || "Untitled",
							description: ago(
								Math.max(
									project.createdAt.toZonedDateTime("UTC").epochMilliseconds,
									ChatUtils.getTimestamp(project.chats[0]),
								),
							),
							target: {
								type: "project",
								project: { id: project.id, title: project.title },
							},
						})),
					},
				],
			});
		} else {
			widgets.push({
				id: "greeting",
				title: "Where should we start?",
				blocks: [
					{
						type: "links",
						links: [
							{
								label: "Go to chats",
								target: { type: "panel", panel: "chats" },
							},
						],
					},
				],
			});
		}

		// const recentChats = [...page.chats]
		// 	.concat(page.projects.flatMap((project) => project.chats))
		// 	.slice(0, LIMIT);
		// if (recentChats.length) {
		// 	widgets.push({
		// 		id: "chats",
		// 		title: "Jump back in...",
		// 		blocks: [
		// 			{
		// 				type: "links",
		// 				links: recentChats.map((chat) => ({
		// 					label: chat.title || "Untitled",
		// 					description: ago(ChatUtils.getTimestamp(chat)),
		// 					target: { type: "chat", id: chat.id },
		// 				})),
		// 			},
		// 		],
		// 	});
		// }

		return widgets;
	}, [page]);

	const open = (target: GetStartedTarget) => {
		if (target.type === "chat") ChatService.setChat({ id: target.id });
		else if (target.type === "project") ChatService.newChat(target.project);
		else if (target.type === "panel") setPanel(target.panel, true);
	};

	return { widgets, open };
};
