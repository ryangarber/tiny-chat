import { ActionIcon, Avatar, Burger, Stack, Tooltip } from "@mantine/core";
import {
	EyeSlashIcon,
	GearIcon,
	GhostIcon,
	PlusCircleIcon,
	UserCircleIcon,
} from "@phosphor-icons/react";
import type { useSession } from "#client/core/hooks/useSession.ts";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import type { useChat } from "#client/features/chat/hooks/useChat.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";

export default function SidebarCollapsed({
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

	return (
		<Stack align="center" justify="space-between" h="100%" py="xs">
			<Stack align="center" gap="sm">
				<Burger
					opened={isSidebarOpen}
					onClick={() => setPanel("chats", !isSidebarOpen)}
					size={16}
				/>
				<Tooltip label="New Chat" position="right">
					<ActionIcon
						size={32}
						variant="subtle"
						c="dimmed"
						className="nav-link-like filled"
						data-active={!chat.data}
						onClick={() => close(() => ChatService.setChat({ id: null }))}
					>
						<PlusCircleIcon size={20} />
					</ActionIcon>
				</Tooltip>
				<Tooltip label="Temporary" position="right">
					<ActionIcon
						size={32}
						variant="subtle"
						c={!isTemporary ? "dimmed" : undefined}
						className="nav-link-like"
						data-active={isTemporary}
						onClick={() =>
							close(() =>
								ChatService.setNewChatOptions({ temporary: !isTemporary }),
							)
						}
					>
						<EyeSlashIcon size={20} />
					</ActionIcon>
				</Tooltip>
				<Tooltip label="Anonymous" position="right">
					<ActionIcon
						size={32}
						variant="subtle"
						c={!isIncognito ? "dimmed" : undefined}
						className="nav-link-like"
						data-active={isIncognito}
						onClick={() =>
							close(() =>
								ChatService.setNewChatOptions({ incognito: !isIncognito }),
							)
						}
					>
						<GhostIcon size={20} />
					</ActionIcon>
				</Tooltip>
			</Stack>
			<Stack align="center" gap="sm">
				<Tooltip
					label={
						!session?.data?.user || session.data.user.isAnonymous
							? "Sign In"
							: session.data.user.name.split(" ")[0]
					}
					position="right"
				>
					<ActionIcon
						size={32}
						variant="subtle"
						c="dimmed"
						className="nav-link-like"
						onClick={() => setCurrentDrawer("account")}
					>
						{session?.data?.user?.image ? (
							<Avatar src={session.data.user.image} size={20} />
						) : (
							<UserCircleIcon size={20} />
						)}
					</ActionIcon>
				</Tooltip>
				<Tooltip label="Settings" position="right">
					<ActionIcon
						variant="subtle"
						size={32}
						c="dimmed"
						className="nav-link-like"
						onClick={() => setCurrentDrawer("settings")}
					>
						<GearIcon size={20} />
					</ActionIcon>
				</Tooltip>
			</Stack>
		</Stack>
	);
}
