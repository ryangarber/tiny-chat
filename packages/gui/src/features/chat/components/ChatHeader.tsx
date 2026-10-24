import { ActionIcon, Burger, Group, Tooltip } from "@mantine/core";
import { EyeSlashIcon, GhostIcon, PlusCircleIcon } from "@phosphor-icons/react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";

export default function ChatHeader({ fixed }: { fixed: boolean }) {
	const { chat } = useChat();
	const isMobile = useAppStore((s) => s.isMobile);
	const isSidebarOpen = useLayoutStore((s) => s.panels.chats);
	const setPanel = useLayoutStore((s) => s.setPanel);
	const temporary = useChatStore(
		(s) => s.active.status === "new" && s.active.temporary,
	);
	const incognito = useChatStore(
		(s) => s.active.status === "new" && s.active.incognito,
	);

	const isTemporary = chat.data?.temporary ?? temporary;
	const isIncognito = chat.data?.incognito ?? incognito;

	return (
		<Group
			pos={fixed ? "fixed" : "sticky"}
			top={0}
			left={0}
			right={0}
			bottom={fixed ? undefined : 0}
			gap={5}
			display={isMobile ? undefined : "none"}
			className="glass"
			style={{
				paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
				paddingLeft: "calc(10px + env(safe-area-inset-left, 0px))",
				paddingRight: "calc(10px + env(safe-area-inset-right, 0px))",
				paddingBottom: "10px",
				zIndex: "calc(var(--mantine-z-index-app) + 1)",
				borderBottom: "1px solid var(--mantine-color-default-border)",
			}}
		>
			<Burger
				opened={isSidebarOpen}
				onClick={() => setPanel("chats", !isSidebarOpen)}
				display={!isMobile || isSidebarOpen ? "none" : undefined}
				size="sm"
			/>
			<Group justify="space-between" flex={1}>
				<Group gap={4}>
					<Tooltip label="New Chat">
						<ActionIcon
							size={32}
							variant="subtle"
							className="nav-link-like filled"
							onClick={() => ChatService.newChat(null)}
							data-active={!chat.data}
						>
							<PlusCircleIcon size={20} />
						</ActionIcon>
					</Tooltip>
				</Group>
				<Group gap={4}>
					<Tooltip label="Temporary">
						<ActionIcon
							size={32}
							variant="subtle"
							className="nav-link-like"
							onClick={() =>
								ChatService.setNewChatOptions({ temporary: !isTemporary })
							}
							data-active={isTemporary}
						>
							<EyeSlashIcon size={20} />
						</ActionIcon>
					</Tooltip>
					<Tooltip label="Anonymous">
						<ActionIcon
							size={32}
							variant="subtle"
							className="nav-link-like"
							onClick={() =>
								ChatService.setNewChatOptions({ incognito: !isIncognito })
							}
							data-active={isIncognito}
						>
							<GhostIcon size={20} />
						</ActionIcon>
					</Tooltip>
				</Group>
			</Group>
		</Group>
	);
}
