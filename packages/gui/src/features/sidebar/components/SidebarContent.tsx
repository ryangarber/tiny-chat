import {
	ActionIcon,
	Button,
	Group,
	Indicator,
	Loader,
	Modal,
	NavLink,
	Overlay,
	Popover,
	ScrollArea,
	Space,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import {
	CaretDownIcon,
	CaretLeftIcon,
	CaretRightIcon,
	DotsThreeIcon,
	PauseCircleIcon,
	PlusIcon,
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
import { useChatStatus } from "#client/features/chat/hooks/useChatStatuses.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	ChatState,
	ProjectState,
} from "#core/features/data/types/chat.ts";
import Sentinel from "#gui/core/components/Sentinel.tsx";
import { useDragAutoScroll } from "#gui/core/hooks/useDragAutoScroll.ts";
import { useSentinel } from "#gui/core/hooks/useSentinel.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import scrollable from "#gui/core/styles/scrollable.module.css";
import CommandSettings from "#gui/features/sidebar/components/CommandSettings.tsx";
import ContextSettings from "#gui/features/sidebar/components/ContextSettings.tsx";
import FolderSettings from "#gui/features/sidebar/components/FolderSettings.tsx";

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
	const status = useChatStatus(chat.id);

	return (
		<Indicator
			size={8}
			disabled={!chat.unseen || !!status}
			color={active ? "white" : "blue"}
			position="middle-start"
			offset={20}
		>
			<NavLink
				key={chat.id}
				label={chat.title ?? "Sending..."}
				variant="filled"
				active={active}
				leftSection={
					status === "generating" ? (
						<Loader
							size={12}
							color={active ? "white" : "blue"}
							aria-label="Generating"
						/>
					) : status === "waiting" ? (
						<PauseCircleIcon
							size={16}
							weight="fill"
							color={active ? "white" : "var(--mantine-color-yellow-filled)"}
							aria-label="Waiting for you"
						/>
					) : undefined
				}
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
				{...(chat.unseen && !status && { pl: 35 })}
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
	const [picking, setPicking] = useState(false);
	const project = useChatStore((state) => state.active.project);
	const projectList =
		projects.data?.pages.flatMap((page) => page.projects) ?? [];
	const chats =
		projects.data?.pages.flatMap((page) =>
			project
				? page.projects
						.filter((item) => item.id === project.id)
						.flatMap((item) => item.chats)
				: page.chats,
		) ?? [];
	const currentProject = projectList.find((item) => item.id === project?.id);
	const selectProject = (next: ProjectState | null) => {
		ChatService.newChat(next);
		setPicking(false);
	};

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
	const { viewportRef: dragViewportRef } = useDragAutoScroll(
		draggedChat !== null,
	);
	const mergedViewportRef = useMergedRef(viewportRef, dragViewportRef);

	return (
		<>
			<Group gap={2} wrap="nowrap" mb="sm">
				<ActionIcon
					variant="subtle"
					c="dimmed"
					aria-label="Previous project"
					onClick={() => ChatService.cycleProject(projectList, -1)}
				>
					<CaretLeftIcon />
				</ActionIcon>
				<Popover
					opened={picking}
					onChange={setPicking}
					width={280}
					position="bottom-start"
				>
					<Popover.Target>
						<Button
							variant="subtle"
							color="gray"
							flex={1}
							miw={0}
							rightSection={<CaretDownIcon />}
							onClick={() => setPicking((value) => !value)}
							onDragEnter={() => setPicking(true)}
							aria-label="Switch project"
							styles={{ label: { minWidth: 0 } }}
						>
							<Text component="span" inherit truncate>
								{currentProject?.title ||
									project?.title ||
									(project ? "Untitled" : "no project")}
							</Text>
						</Button>
					</Popover.Target>
					<Popover.Dropdown p={4}>
						<ScrollArea.Autosize mah={360}>
							{[null, ...projectList].map((item) => (
								<Stack
									key={item?.id ?? ""}
									gap={0}
									pos="relative"
									onDragEnter={(event) =>
										handleDragEnter(event, item?.id ?? null)
									}
									onDragOver={(event) =>
										handleDragOver(event, item?.id ?? null)
									}
									onDragLeave={handleDragLeave}
									onDrop={(event) => {
										handleDrop(event, item?.id ?? null);
										setPicking(false);
									}}
								>
									<NavLink
										label={item ? item.title || "Untitled" : "no project"}
										active={item?.id === project?.id}
										onClick={() => selectProject(item)}
										rightSection={
											item ? (
												<ActionIcon
													size={24}
													variant="subtle"
													aria-label={`Edit ${item.title || "Untitled"}`}
													onClick={(event) => {
														event.stopPropagation();
														setEditing(item);
														setPicking(false);
														useAppStore
															.getState()
															.setCurrentModal("edit-project");
													}}
												>
													<DotsThreeIcon size={20} />
												</ActionIcon>
											) : undefined
										}
									/>
									{dropProjectId === (item?.id ?? null) ? (
										<ChatDropOverlay
											label={`Move to ${item ? item.title || "Untitled" : "no project"}`}
											color="blue"
										/>
									) : null}
								</Stack>
							))}
						</ScrollArea.Autosize>
						<Button
							fullWidth
							variant="subtle"
							leftSection={<PlusIcon />}
							loading={createProject.isPending}
							onClick={() =>
								createProject.mutate(undefined, {
									onSuccess: (created) => {
										setEditing({ ...created, chats: [] });
										setPicking(false);
										useAppStore.getState().setCurrentModal("edit-project");
									},
								})
							}
						>
							New project
						</Button>
					</Popover.Dropdown>
				</Popover>
				<ActionIcon
					variant="subtle"
					c="dimmed"
					aria-label="Next project"
					onClick={() => ChatService.cycleProject(projectList, 1)}
				>
					<CaretRightIcon />
				</ActionIcon>
			</Group>
			<ScrollArea
				key={project?.id ?? ""}
				flex={1}
				viewportRef={mergedViewportRef}
			>
				<Stack gap={10}>
					{chats.map((chat) => (
						<Chat
							key={chat.id}
							chat={chat}
							setEditing={setEditing}
							dragHandlers={dragHandlers}
						/>
					))}
					{!chats.length && !projects.isPending ? (
						<Text size="sm" c="dimmed" px="sm">
							nothing here yet
						</Text>
					) : null}
					{!project ? (
						<Sentinel isFetching={projects.isFetching} ref={sentinelRef} />
					) : null}
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
