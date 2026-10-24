import {
	ActionIcon,
	Avatar,
	Burger,
	Group,
	NavLink,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { spotlight } from "@mantine/spotlight";
import {
	EyeSlashIcon,
	GearIcon,
	GhostIcon,
	MagnifyingGlassIcon,
	PlusCircleIcon,
	UserCircleIcon,
} from "@phosphor-icons/react";
import type { useSession } from "#client/core/hooks/useSession.ts";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import type { useChat } from "#client/features/chat/hooks/useChat.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import SidebarContent from "#gui/features/sidebar/components/SidebarContent.tsx";
import workspace from "../../../../../../package.json" with { type: "json" };

export default function SidebarExpanded({
	chat,
	session,
	isTemporary,
	isIncognito,
	close,
}: {
	chat: ReturnType<typeof useChat>["chat"];
	session: ReturnType<typeof useSession>["session"];
	isTemporary: boolean;
	isIncognito: boolean;
	close: (fn: () => void) => void;
}) {
	const isSidebarOpen = useLayoutStore((state) => state.panels.chats);
	const setPanel = useLayoutStore((state) => state.setPanel);
	const setCurrentDrawer = useAppStore((state) => state.setCurrentDrawer);

	const project = useChatStore((state) => state.active.project);

	return (
		<Stack gap={0} h="100%">
			<Group justify="space-between" p="xs" wrap="nowrap">
				<ActionIcon variant="transparent" onClick={spotlight.open}>
					<MagnifyingGlassIcon size={20} color="var(--mantine-color-text)" />
				</ActionIcon>
				<Burger
					opened={isSidebarOpen}
					onClick={() => setPanel("chats", !isSidebarOpen)}
					size={16}
				/>
			</Group>
			<Group align="center" my="md" gap={3} wrap="nowrap">
				<NavLink
					label="New Chat"
					variant="filled"
					c="dimmed"
					className="nav-link-like filled"
					leftSection={<PlusCircleIcon size={20} />}
					onClick={() => close(() => ChatService.newChat(null))}
					active={!chat.data && !project}
					flex={1}
					h={40}
				/>
				<Tooltip label="Temporary" position="right">
					<ActionIcon
						size={40}
						variant="subtle"
						c={!isTemporary ? "dimmed" : undefined}
						className="nav-link-like"
						onClick={() =>
							close(() =>
								ChatService.setNewChatOptions({ temporary: !isTemporary }),
							)
						}
						data-active={isTemporary}
					>
						<EyeSlashIcon size={20} />
					</ActionIcon>
				</Tooltip>
				<Tooltip label="Anonymous" position="right">
					<ActionIcon
						size={40}
						variant="subtle"
						c={!isIncognito ? "dimmed" : undefined}
						className="nav-link-like"
						onClick={() =>
							close(() =>
								ChatService.setNewChatOptions({ incognito: !isIncognito }),
							)
						}
						data-active={isIncognito}
					>
						<GhostIcon size={20} />
					</ActionIcon>
				</Tooltip>
			</Group>
			<SidebarContent />
			<NavLink
				mt="lg"
				c="dimmed"
				label={
					!session?.data?.user || session.data.user.isAnonymous
						? "Sign In"
						: session.data.user.name.split(" ")[0]
				}
				leftSection={
					session?.data?.user?.image ? (
						<Avatar src={session.data.user.image} size={18} />
					) : (
						<UserCircleIcon size={20} />
					)
				}
				onClick={() => setCurrentDrawer("account")}
				h={40}
				mb={5}
			/>
			<NavLink
				c="dimmed"
				label={
					<Group justify="space-between" wrap="nowrap">
						Settings
						<Text size="sm" c="dimmed" pr={5}>
							{workspace.version}
						</Text>
					</Group>
				}
				leftSection={<GearIcon size={20} />}
				onClick={() => setCurrentDrawer("settings")}
				h={40}
				mb={5}
			/>
		</Stack>
	);
}
