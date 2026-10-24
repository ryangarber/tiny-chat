import { useInput } from "ink";
import { useState } from "react";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import Box from "#tui/core/components/Box.tsx";
import { usePanel } from "#tui/core/components/Panel.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useSentinel } from "#tui/core/hooks/useSentinel.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import ProjectList, {
	NO_PROJECT,
} from "#tui/features/chat/components/ProjectList.tsx";
import Completions from "#tui/features/editor/components/Completions.tsx";

/**
 * The project the chats below are listed for, between arrows that step to the
 * one before and after it; a press on its name opens the full list.
 */
function ProjectSwitcher({
	title,
	onCycle,
	onOpen,
}: {
	title: string;
	onCycle: (direction: 1 | -1) => void;
	onOpen: () => void;
}) {
	const { focused } = usePanel();

	const [hovered, setHovered] = useState<number | null>(null);
	const { mouseRef } = useMouseInput({
		onClick: ({ index }) => {
			if (index === 1) onOpen();
			else onCycle(index === 0 ? -1 : 1);
		},
		onHoverStart: ({ index }) => setHovered(index),
		onHoverEnd: ({ index }) =>
			setHovered((current) => (current === index ? null : current)),
	});

	return (
		<Box gap={1} marginBottom={1} flexShrink={0}>
			<Box ref={(element) => mouseRef(element, 0)} flexShrink={0}>
				<Text color="textSubtle" dimColor={hovered === 0}>
					◂
				</Text>
			</Box>
			<Box ref={(element) => mouseRef(element, 1)} flexShrink={1} minWidth={0}>
				<Text
					bold
					wrap="truncate-end"
					color={focused ? "primary" : undefined}
					dimColor={hovered === 1}
				>
					{title}
				</Text>
			</Box>
			<Box ref={(element) => mouseRef(element, 2)} flexShrink={0}>
				<Text color="textSubtle" dimColor={hovered === 2}>
					▸
				</Text>
			</Box>
		</Box>
	);
}

export default function ChatList({
	fill = false,
}: {
	/** Drawn as a sidebar, taking the full height it is given. */
	fill?: boolean;
}) {
	const { projects, deleteChat } = useChatList();
	useWorkingStatus(projects, deleteChat);

	const project = useChatStore((state) => state.active.project);
	const projectList =
		projects.data?.pages.flatMap((page) => page.projects) ?? [];
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

	// The projects open in place of the chats, from the switcher above them.
	const [picking, setPicking] = useState(false);

	const { focused } = usePanel();
	const closePanel = useAppStore((state) => state.closePanel);
	const { setPage } = usePage({
		active: focused && !picking,
		onBack: () => {
			closePanel("chats");
			return false;
		},
	});

	const cycle = (direction: 1 | -1) =>
		ChatService.cycleProject(projectList, direction);

	useInput(
		(input, key) => {
			if (key.leftArrow) cycle(-1);
			if (key.rightArrow) cycle(1);
			if (input === "p" && !key.ctrl && !key.meta) setPicking(true);
		},
		{ isActive: focused && !picking },
	);

	if (picking) {
		return <ProjectList fill={fill} onClose={() => setPicking(false)} />;
	}

	return (
		<Completions
			// Another project's chats are scrolled from their top.
			key={project?.id ?? ""}
			fill={fill}
			itemProps={
				fill ? { flexGrow: 1, minWidth: 0, wrap: "truncate-end" } : undefined
			}
			before={
				<ProjectSwitcher
					title={project ? project.title || "Untitled" : NO_PROJECT}
					onCycle={cycle}
					onOpen={() => setPicking(true)}
				/>
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
			actions={[
				{ key: "←→", name: "project", when: projectList.length > 0 },
				{ key: "p", name: "projects", onClick: () => setPicking(true) },
				"back",
			]}
			selectFirstOnChange={false}
			onReachBottom={project ? undefined : fetchOlder}
		/>
	);
}
