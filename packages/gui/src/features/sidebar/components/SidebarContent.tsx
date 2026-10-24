import {
	ActionIcon,
	Button,
	Group,
	Indicator,
	Modal,
	NavLink,
	Overlay,
	ScrollArea,
	Space,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import {
	CaretRightIcon,
	DotsThreeIcon,
	PlusCircleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import {
	type Dispatch,
	type DragEvent,
	type SetStateAction,
	useContext,
	useState,
} from "react";
import { ClientContext } from "#client/client.ts";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	ChatState,
	ProjectState,
} from "#core/features/data/types/chat.ts";
import Sentinel from "#gui/core/components/Sentinel.tsx";
import { useSentinel } from "#gui/core/hooks/useSentinel.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import scrollable from "#gui/core/styles/scrollable.module.css";
import CommandSettings from "#gui/features/sidebar/components/CommandSettings.tsx";
import ContextSettings from "#gui/features/sidebar/components/ContextSettings.tsx";
import FolderSettings from "#gui/features/sidebar/components/FolderSettings.tsx";

/** Projects shown before the rest are folded under "More". */
const PROJECT_LIMIT = 3;

type ChatDragHandlers = {
	onDragEnd: () => void;
	onDragStart: (event: DragEvent<HTMLElement>, chat: ChatState) => void;
};

function ChatDropOverlay({ label, color }: { label: string; color: string }) {
	return (
		<Overlay
			color={`var(--mantine-color-${color}-filled)`}
			backgroundOpacity={0.2}
			blur={1}
			radius="md"
			center
			zIndex={5}
			style={{
				border: `1px dashed var(--mantine-color-${color}-5)`,
				pointerEvents: "none",
			}}
		>
			<Text
				fw={600}
				size="sm"
				px="sm"
				py={6}
				style={{
					background: "var(--mantine-color-body)",
					borderRadius: "var(--mantine-radius-md)",
					boxShadow: "var(--mantine-shadow-md)",
				}}
			>
				{label}
			</Text>
		</Overlay>
	);
}

function Project({
	project,
	setEditing,
	dragHandlers,
	dropActive,
	onDragEnter,
	onDragLeave,
	onDragOver,
	onDrop,
}: {
	project: ProjectState;
	setEditing: Dispatch<SetStateAction<ProjectState | ChatState | null>>;
	dragHandlers: ChatDragHandlers;
	dropActive: boolean;
	onDragEnter: (event: DragEvent<HTMLElement>) => void;
	onDragLeave: (event: DragEvent<HTMLElement>) => void;
	onDragOver: (event: DragEvent<HTMLElement>) => void;
	onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
	const isMobile = useAppStore((state) => state.isMobile);
	const setPanel = useLayoutStore((state) => state.setPanel);
	const currentProject = useChatStore((state) => state.active.project);
	const hasChat = useChatStore((state) => !!state.active.chatId);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);

	const [isExpanded, setExpanded] = useState(false);

	const active = !hasChat && currentProject?.id === project.id;

	return (
		<Stack
			gap={0}
			pos="relative"
			onDragEnter={onDragEnter}
			onDragLeave={onDragLeave}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<NavLink
				key={project.id}
				label={project.title || "Untitled"}
				h={40}
				opened={isExpanded}
				onChange={setExpanded}
				className={`right-section-hover${active || isMobile ? " hover" : ""}`}
				leftSection={
					<CaretRightIcon
						color="var(--mantine-color-dimmed)"
						style={{
							transform: `rotate(${isExpanded ? 90 : 0}deg)`,
							transition: "transform 200ms ease",
						}}
					/>
				}
				rightSection={
					<Group gap={10}>
						<ActionIcon
							size={24}
							radius="xl"
							variant="light"
							onClick={(e) => {
								e.stopPropagation();
								setEditing(project);
								setCurrentModal("edit-project");
							}}
						>
							<DotsThreeIcon size={20} />
						</ActionIcon>
						<ActionIcon
							c={active ? undefined : "dimmed"}
							variant={active ? "filled" : "subtle"}
							className="nav-link-like filled"
							onClick={(event) => {
								event.stopPropagation();
								ChatService.newChat(project);
								if (isMobile) setPanel("chats", false);
							}}
							data-active={active}
						>
							<PlusCircleIcon />
						</ActionIcon>
					</Group>
				}
				disableRightSectionRotation
				defaultOpened
			>
				{project.chats.map((chat) => (
					<Chat
						key={chat.id}
						chat={chat}
						setEditing={setEditing}
						dragHandlers={dragHandlers}
					/>
				))}
			</NavLink>
			{dropActive ? (
				<ChatDropOverlay
					label={`Move to ${project.title || "Untitled"}`}
					color="blue"
				/>
			) : null}
		</Stack>
	);
}

function ProjectEditor({ editing }: { editing: ProjectState }) {
	const { updateProject, deleteProject } = useChatList();

	const currentModal = useAppStore((state) => state.currentModal);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);

	const [title, setTitle] = useState(editing.title ?? "");

	const save = () => {
		updateProject.mutate(
			{ project: editing, title },
			{ onSuccess: () => setCurrentModal(null) },
		);
	};

	return (
		<Modal
			title="Edit Project"
			opened={currentModal === "edit-project"}
			onClose={() => setCurrentModal(null)}
			centered
			classNames={scrollable}
		>
			<ScrollArea.Autosize offsetScrollbars>
				<Stack>
					<TextInput
						label="Title"
						value={title}
						disabled={updateProject.isPending}
						onChange={(e) => setTitle(e.target.value)}
						data-autofocus
					/>
					<FolderSettings project={editing.id} />
					<Space />
					<CommandSettings project={editing.id} />
					<Space />
					<ContextSettings project={editing.id} />
					<Button.Group mt="lg">
						<Button
							variant="default"
							fullWidth
							onClick={save}
							loading={updateProject.isPending}
							disabled={updateProject.isPending || !title}
						>
							Save
						</Button>
						<Button
							variant="outline"
							color="red"
							onClick={() =>
								deleteProject.mutate(
									{ project: editing, deleteChats: true },
									{ onSuccess: () => setCurrentModal(null) },
								)
							}
							loading={deleteProject.isPending}
							disabled={deleteProject.isPending}
						>
							<TrashIcon size={20} />
						</Button>
					</Button.Group>
				</Stack>
			</ScrollArea.Autosize>
		</Modal>
	);
}

function Chat({
	chat,
	setEditing,
	dragHandlers,
}: {
	chat: ChatState;
	setEditing: Dispatch<SetStateAction<ProjectState | ChatState | null>>;
	dragHandlers: ChatDragHandlers;
}) {
	const active = useChatStore((state) => state.active.chatId === chat.id);
	const isMobile = useAppStore((state) => state.isMobile);
	const setPanel = useLayoutStore((state) => state.setPanel);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);

	return (
		<Indicator
			size={8}
			disabled={!chat.unseen}
			color={active ? "white" : "blue"}
			position="middle-start"
			offset={20}
		>
			<NavLink
				key={chat.id}
				label={chat.title ?? "Sending..."}
				variant="filled"
				active={active}
				className={`right-section-hover${active || isMobile ? " hover" : ""}`}
				onClick={() => {
					ChatService.setChat(chat);
					if (isMobile) setPanel("chats", false);
				}}
				h={40}
				draggable
				onDragStart={(event) => dragHandlers.onDragStart(event, chat)}
				onDragEnd={dragHandlers.onDragEnd}
				style={{ cursor: "grab" }}
				{...(chat.unseen && { pl: 35 })}
				rightSection={
					<ActionIcon
						size={24}
						radius="xl"
						variant={active ? "white" : "light"}
						onClick={(e) => {
							e.stopPropagation();
							setEditing(chat);
							setCurrentModal("edit-chat");
						}}
					>
						<DotsThreeIcon size={20} />
					</ActionIcon>
				}
			/>
		</Indicator>
	);
}

function ChatEditor({ editing }: { editing: ChatState }) {
	const { renameChat, deleteChat } = useChatList();

	const currentModal = useAppStore((state) => state.currentModal);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);

	const [title, setTitle] = useState(editing.title ?? "");

	return (
		<Modal
			title="Edit Chat"
			opened={currentModal === "edit-chat"}
			onClose={() => setCurrentModal(null)}
			centered
		>
			<Stack>
				<TextInput
					placeholder="Chat Title"
					mb={10}
					value={title}
					disabled={renameChat.isPending}
					onChange={(e) => setTitle(e.target.value)}
					data-autofocus
				/>
				<Button.Group>
					<Button
						variant="default"
						fullWidth
						onClick={() =>
							editing &&
							renameChat.mutate(
								{ chat: editing, title },
								{ onSuccess: () => setCurrentModal(null) },
							)
						}
						loading={renameChat.isPending}
						disabled={renameChat.isPending || !title}
					>
						Save
					</Button>
					<Button
						variant="outline"
						color="red"
						onClick={() =>
							deleteChat.mutate(
								{ chat: editing },
								{ onSuccess: () => setCurrentModal(null) },
							)
						}
						loading={deleteChat.isPending}
						disabled={deleteChat.isPending}
					>
						<TrashIcon size={20} />
					</Button>
				</Button.Group>
			</Stack>
		</Modal>
	);
}

export default function SidebarContent() {
	const client = useContext(ClientContext);

	const { projects, createProject, moveChat } = useChatList();

	const currentModal = useAppStore((state) => state.currentModal);

	const [editing, setEditing] = useState<ProjectState | ChatState | null>(null);
	const [draggedChat, setDraggedChat] = useState<ChatState | null>(null);
	const [dropProjectId, setDropProjectId] = useState<string | null | undefined>(
		undefined,
	);
	const [allProjects, setAllProjects] = useState(false);
	const projectList =
		projects.data?.pages.flatMap((page) => page.projects) ?? [];
	const hiddenProjects = Math.max(0, projectList.length - PROJECT_LIMIT);

	const dragHandlers: ChatDragHandlers = {
		onDragStart: (event, dragged) => {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", dragged.id);
			setDraggedChat(dragged);
		},
		onDragEnd: () => {
			setDraggedChat(null);
			setDropProjectId(undefined);
		},
	};

	const isValidDrop = (projectId: string | null) =>
		draggedChat !== null && draggedChat.projectId !== projectId;
	const handleDragEnter = (
		event: DragEvent<HTMLElement>,
		projectId: string | null,
	) => {
		if (!isValidDrop(projectId)) return;
		event.preventDefault();
		setDropProjectId(projectId);
	};
	const handleDragOver = (
		event: DragEvent<HTMLElement>,
		projectId: string | null,
	) => {
		if (!isValidDrop(projectId)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
	};
	const handleDragLeave = (event: DragEvent<HTMLElement>) => {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget))
			return;
		setDropProjectId(undefined);
	};
	const handleDrop = (
		event: DragEvent<HTMLElement>,
		projectId: string | null,
	) => {
		if (!isValidDrop(projectId) || !draggedChat) return;
		event.preventDefault();
		moveChat.mutate({ chat: draggedChat, projectId });
		setDraggedChat(null);
		setDropProjectId(undefined);
	};

	const { viewportRef, sentinelRef } = useSentinel({
		query: projects,
		queryKey: client.query.chat.getChatList.pathKey(),
	});

	return (
		<>
			<ScrollArea
				flex={1}
				viewportRef={viewportRef}
				styles={{
					content: {
						display: "flex",
						flexDirection: "column",
						minHeight: "100%",
					},
				}}
			>
				<Stack gap={10} flex={1}>
					<Group justify="space-between" px="sm">
						<Text size="sm" c="dimmed">
							Projects
						</Text>
						<ActionIcon
							c="dimmed"
							variant="subtle"
							className="nav-link-like"
							loading={createProject.isPending}
							disabled={createProject.isPending}
							onClick={() => createProject.mutate()}
						>
							+
						</ActionIcon>
					</Group>
					{(allProjects
						? projectList
						: projectList.slice(0, PROJECT_LIMIT)
					).map((project) => (
						<Project
							key={project.id}
							project={project}
							setEditing={setEditing}
							dragHandlers={dragHandlers}
							dropActive={dropProjectId === project.id}
							onDragEnter={(event) => handleDragEnter(event, project.id)}
							onDragLeave={handleDragLeave}
							onDragOver={(event) => handleDragOver(event, project.id)}
							onDrop={(event) => handleDrop(event, project.id)}
						/>
					))}
					{hiddenProjects > 0 && (
						<NavLink
							h={32}
							c="dimmed"
							label={allProjects ? "Less" : `${hiddenProjects} more`}
							leftSection={<DotsThreeIcon />}
							onClick={() => setAllProjects((previous) => !previous)}
						/>
					)}
					<Stack
						gap={10}
						flex={1}
						mih={120}
						pos="relative"
						onDragEnter={(event) => handleDragEnter(event, null)}
						onDragLeave={handleDragLeave}
						onDragOver={(event) => handleDragOver(event, null)}
						onDrop={(event) => handleDrop(event, null)}
					>
						<Text size="sm" c="dimmed" px="sm">
							Recents
						</Text>
						{projects.data?.pages
							.flatMap((page) => page.chats)
							.map((chat) => (
								<Chat
									key={chat.id}
									chat={chat}
									setEditing={setEditing}
									dragHandlers={dragHandlers}
								/>
							))}
						<Sentinel isFetching={projects.isFetching} ref={sentinelRef} />
						{dropProjectId === null ? (
							<ChatDropOverlay label="Move to Recents" color="grape" />
						) : null}
					</Stack>
				</Stack>
			</ScrollArea>
			{currentModal === "edit-chat" && (
				<ChatEditor editing={editing as ChatState} />
			)}
			{currentModal === "edit-project" && (
				<ProjectEditor editing={editing as ProjectState} />
			)}
		</>
	);
}
