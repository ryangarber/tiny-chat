import { useState } from "react";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { usePanel } from "#tui/core/components/Panel.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import ProjectEditor from "#tui/features/chat/components/ProjectEditor.tsx";
import Completions from "#tui/features/editor/components/Completions.tsx";

/** What the chats outside of any project are listed under. */
export const NO_PROJECT = "no project";

/**
 * The projects, opened from the switcher at the top of the chat list: picking
 * one starts a new chat in it and goes back to its chats.
 */
export default function ProjectList({
	fill = false,
	onClose,
}: {
	fill?: boolean;
	onClose: () => void;
}) {
	const { projects, createProject, deleteProject } = useChatList();
	useWorkingStatus(projects, createProject, deleteProject);
	const items = projects.data?.pages.flatMap((page) => page.projects) ?? [];

	const current = useChatStore((state) => state.active.project);
	// Opened on the project the chats are listed for.
	const [selected, setSelected] = useState(
		() => 1 + items.findIndex((project) => project.id === current?.id),
	);

	// Looked up afresh so the editor shows a rename as soon as it lands.
	const [editingId, setEditingId] = useState<string | null>(null);
	const editing = items.find((project) => project.id === editingId);

	// The editor takes `back` while it is open, closing itself last.
	const { focused } = usePanel();
	usePage({
		active: focused,
		onBack: () => {
			if (!editing) onClose();
			return false;
		},
	});

	if (editing) {
		return (
			<ProjectEditor project={editing} onClose={() => setEditingId(null)} />
		);
	}

	return (
		<Completions
			fill={fill}
			itemProps={
				fill ? { flexGrow: 1, minWidth: 0, wrap: "truncate-end" } : undefined
			}
			selected={selected}
			setSelected={(update) => setSelected((previous) => update(previous))}
			selectFirstOnChange={false}
			groups={[
				{
					name: "projects",
					items: [
						{ name: NO_PROJECT, value: "", active: !current },
						...items.map((project) => ({
							name: project.title || "Untitled",
							value: project.id,
							active: project.id === current?.id,
						})),
					],
				},
			]}
			bindings={{
				primary: {
					name: "switch",
					run: (item) => {
						ChatService.newChat(
							items.find((project) => project.id === item.value) ?? null,
						);
						onClose();
					},
				},
				edit: {
					run: (item) => setEditingId(item.value),
					when: (item) => !!item.value,
				},
				// A new project opens in its editor, where it is named.
				create: {
					name: "new project",
					run: () =>
						createProject.mutate(undefined, {
							onSuccess: (project) => setEditingId(project.id),
						}),
				},
				remove: {
					name: "delete",
					label: (item) => `delete "${item.name}" and its chats?`,
					run: (item) => {
						const project = items.find((project) => project.id === item.value);
						if (project) deleteProject.mutate({ project, deleteChats: true });
					},
					when: (item) => !!item.value,
				},
			}}
			actions={["back"]}
		/>
	);
}
