import { useContext, useState } from "react";
import { ClientContext } from "#client/client.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import { useInstructions } from "#client/features/settings/hooks/useInstructions.ts";
import { useShellSettings } from "#client/features/settings/hooks/useShellSettings.ts";
import type { ProjectState } from "#core/features/data/types/chat.ts";
import { usePanel } from "#tui/core/components/Panel.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import CommandSettings from "#tui/features/settings/components/CommandSettings.tsx";
import Details, {
	type DetailsItem,
} from "#tui/features/settings/components/Details.tsx";
import FolderSettings from "#tui/features/settings/components/FolderSettings.tsx";
import InstructionSettings from "#tui/features/settings/components/InstructionSettings.tsx";
import MemoryBudgetSettings from "#tui/features/settings/components/MemoryBudgetSettings.tsx";
import TextList, {
	type Draft,
} from "#tui/features/settings/components/TextList.tsx";

/** The settings a project keeps for itself, like the app's project editor. */
export default function ProjectEditor({
	project,
	onClose,
}: {
	project: ProjectState;
	onClose: () => void;
}) {
	const client = useContext(ClientContext);

	const { updateProject, deleteProject } = useChatList();
	useWorkingStatus(updateProject, deleteProject);

	const { instructions, memoryBudget } = useInstructions({ project });
	const { commands, folders } = useShellSettings({ project });

	const [path, setPath] = useState<string[]>([]);
	const route = path.at(-1) ?? null;
	const push = (next: string) => setPath((current) => [...current, next]);
	const pop = () => setPath((current) => current.slice(0, -1));

	const [draft, setDraft] = useState<Draft | null>(null);
	const [selected, setSelected] = useState(0);

	const { focused } = usePanel();
	usePage({
		active: focused,
		onBack: () => {
			if (draft) setDraft(null);
			else if (path.length) pop();
			else onClose();
			return false;
		},
	});

	if (route === "title") {
		return (
			<TextList
				entries={[{ label: "title", text: project.title ?? "" }]}
				draft={draft}
				setDraft={setDraft}
				placeholder="Untitled"
				onEdit={(_, title) => {
					if (title) updateProject.mutate({ project, title });
				}}
			/>
		);
	}
	if (route === "instructions") {
		return (
			<InstructionSettings
				project={project}
				draft={draft}
				setDraft={setDraft}
			/>
		);
	}
	if (route === "memoryBudget") {
		return <MemoryBudgetSettings project={project} onDone={pop} />;
	}
	if (route === "commands") {
		return (
			<CommandSettings project={project} draft={draft} setDraft={setDraft} />
		);
	}
	if (route === "folders") {
		return (
			<FolderSettings project={project} draft={draft} setDraft={setDraft} />
		);
	}
	const groups: CompletionGroup<DetailsItem>[] = [
		{
			name: "project",
			items: [
				{
					name: "title",
					value: "title",
					state: project.title || "Untitled",
					route: "title",
				},
			],
		},
		{
			name: "shell",
			items: [
				...(client.desktop
					? [
							{
								name: "folders",
								value: "folders",
								state: String(folders.length),
								route: "folders",
							},
						]
					: []),
				{
					name: "commands",
					value: "commands",
					state: String(commands.length),
					route: "commands",
				},
			],
		},
		{
			name: "context",
			items: [
				{
					name: "instructions",
					value: "instructions",
					state: String(instructions?.length ?? 0),
					route: "instructions",
				},
				{
					name: "memory budget",
					value: "memory budget",
					state: String(memoryBudget),
					route: "memoryBudget",
				},
			],
		},
	];

	return (
		<Details
			groups={groups}
			selected={selected}
			setSelected={setSelected}
			onOpen={push}
			remove={{
				name: "delete",
				label: `delete "${project.title || "Untitled"}" and its chats?`,
				run: () =>
					deleteProject.mutate(
						{ project, deleteChats: true },
						{ onSuccess: onClose },
					),
			}}
		/>
	);
}
