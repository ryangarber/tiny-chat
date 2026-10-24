import { Spotlight } from "@mantine/spotlight";
import { type CSSProperties, useCallback, useState } from "react";
import { useSession } from "#client/core/hooks/useSession.ts";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useEmbedding } from "#client/features/user/hooks/useEmbedding.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import AccountDrawer from "#gui/features/sidebar/components/AccountDrawer.tsx";
import SettingsDrawer from "#gui/features/sidebar/components/SettingsDrawer.tsx";
import SidebarCollapsed from "#gui/features/sidebar/components/SidebarCollapsed.tsx";
import SidebarExpanded from "#gui/features/sidebar/components/SidebarExpanded.tsx";
import { useSearch } from "#gui/features/sidebar/hooks/useSearch.ts";

export default function Sidebar() {
	const { session } = useSession();
	const { chat } = useChat();

	const isMobile = useAppStore((state) => state.isMobile);

	const isSidebarOpen = useLayoutStore((state) => state.panels.chats);
	const setPanel = useLayoutStore((state) => state.setPanel);
	const currentDrawer = useAppStore((state) => state.currentDrawer);
	const setCurrentDrawer = useAppStore((state) => state.setCurrentDrawer);

	const createTemporary = useChatStore(
		(state) => state.active.status === "new" && state.active.temporary,
	);
	const createIncognito = useChatStore(
		(state) => state.active.status === "new" && state.active.incognito,
	);
	const isTemporary = chat.data?.temporary ?? createTemporary;
	const isIncognito = chat.data?.incognito ?? createIncognito;

	const close = useCallback(
		(action?: () => void) => {
			action?.();
			if (isMobile) setPanel("chats", false);
		},
		[isMobile, setPanel],
	);

	const [query, setQuery] = useState("");
	const { actions } = useSearch({ query, onSelect: close });

	const { embeddingStatus } = useEmbedding();

	return (
		<>
			{isMobile && (
				<SidebarExpanded
					chat={chat}
					session={session}
					isTemporary={isTemporary}
					isIncognito={isIncognito}
					close={close}
				/>
			)}
			{!isMobile && (
				<div
					style={{ position: "relative", height: "100%", overflow: "hidden" }}
				>
					<div
						style={{
							position: "absolute",
							inset: 0,
							opacity: `var(--sidebar-expanded-opacity, ${isSidebarOpen ? 1 : 0})`,
							visibility:
								`var(--sidebar-expanded-visibility, ${isSidebarOpen ? "visible" : "hidden"})` as CSSProperties["visibility"],
							transition:
								"var(--sidebar-opacity-transition, opacity 200ms ease 50ms), visibility 0ms linear " +
								(isSidebarOpen ? "0ms" : "250ms"),
							display: "flex",
							flexDirection: "column",
						}}
					>
						<SidebarExpanded
							chat={chat}
							session={session}
							isTemporary={isTemporary}
							isIncognito={isIncognito}
							close={close}
						/>
					</div>
					<div
						style={{
							position: "absolute",
							top: 0,
							bottom: 0,
							left: 0,
							width: 40,
							opacity: `var(--sidebar-collapsed-opacity, ${isSidebarOpen ? 0 : 1})`,
							visibility:
								`var(--sidebar-collapsed-visibility, ${isSidebarOpen ? "hidden" : "visible"})` as CSSProperties["visibility"],
							transition:
								"var(--sidebar-opacity-transition, opacity 200ms ease 50ms), visibility 0ms linear " +
								(isSidebarOpen ? "250ms" : "0ms"),
							display: "flex",
							flexDirection: "column",
						}}
					>
						<SidebarCollapsed
							chat={chat}
							session={session}
							isTemporary={isTemporary}
							isIncognito={isIncognito}
							close={close}
						/>
					</div>
				</div>
			)}
			<AccountDrawer
				opened={currentDrawer === "account"}
				onClose={() => setCurrentDrawer(null)}
			/>
			<SettingsDrawer
				opened={currentDrawer === "settings"}
				onClose={() => setCurrentDrawer(null)}
				embeddingStatus={embeddingStatus}
			/>
			<Spotlight
				actions={actions.data?.pages.flatMap((p) => p.results) ?? []}
				query={query}
				onQueryChange={setQuery}
				highlightQuery
				scrollAreaProps={{
					mah: 400,
					onBottomReached: () => {
						if (actions.isFetching) return;
						void actions.fetchNextPage();
					},
				}}
				nothingFound={
					actions.isFetching
						? "Searching..."
						: query.trim().length >= 3
							? "No results"
							: "Type to search…"
				}
				filter={(_, actions) => actions}
			/>
		</>
	);
}
