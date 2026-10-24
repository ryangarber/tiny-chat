import { type DOMElement, useApp, useInput, useWindowSize } from "ink";
import { type ReactNode, useEffect, useRef } from "react";
import { usePrepareCode } from "#client/core/hooks/useCode.ts";
import { usePersistedPanels } from "#client/core/hooks/usePersistedPanels.ts";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { useDefaultProject } from "#client/features/chat/hooks/useDefaultProject.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useEstimatedTokens } from "#client/features/editor/hooks/useEstimatedTokens.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { MessageProvider } from "#client/features/message/components/MessageProvider.tsx";
import Box from "#tui/core/components/Box.tsx";
import Console from "#tui/core/components/Console.tsx";
import { ContentFullscreen } from "#tui/core/components/Content.tsx";
import Panel from "#tui/core/components/Panel.tsx";
import StatusText from "#tui/core/components/StatusText.tsx";
import type { Color } from "#tui/core/hooks/useColor.ts";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import { WidthContext } from "#tui/core/hooks/useWidth.ts";
import {
	type Panel as PanelName,
	selectFocus,
	selectPage,
	useAppStore,
} from "#tui/core/stores/useAppStore.ts";
import ChatConfig from "#tui/features/agent/components/ChatConfig.tsx";
import Chat from "#tui/features/chat/components/Chat.tsx";
import ChatEffects from "#tui/features/chat/components/ChatEffects.tsx";
import ChatList from "#tui/features/chat/components/ChatList.tsx";
import ChatSources from "#tui/features/chat/components/ChatSources.tsx";
import Editor from "#tui/features/editor/components/Editor.tsx";
import Find from "#tui/features/find/components/Find.tsx";
import FindScope from "#tui/features/find/components/FindScope.tsx";
import { CitationCard } from "#tui/features/message/components/Citation.tsx";
import { useSelectionStore } from "#tui/features/selection/stores/useSelectionStore.ts";
import Settings from "#tui/features/settings/components/Settings.tsx";
import { useUpdate } from "#tui/features/update/hooks/useUpdate.ts";
import GitHub from "#tui/features/upload/components/GitHub.tsx";
import Uploads from "#tui/features/upload/components/Uploads.tsx";
import Actions from "#tui/features/user/components/Actions.tsx";
import Memories from "#tui/features/user/components/Memories.tsx";

/** Columns from which the chat list and files open beside the chat rather than below it. */
const SIDEBAR_COLUMNS = 120;

/** The scope of the whole screen, searched once nothing narrower is. */
const FIND_ROOT = "app";
// Halfway between the former chat-list (32) and file-preview (up to 64) widths.
const panelWidth = (columns: number) =>
	Math.floor((32 + Math.min(64, Math.floor(columns * 0.4))) / 2);

export default function App() {
	usePrepareCode();
	useDefaultProject();
	usePersistedPanels();

	const { exit } = useApp();
	const rootRef = useRef<DOMElement>(null);
	const { rows, columns } = useWindowSize();

	const page = useAppStore(selectPage);
	// A page takes the mouse over the chat it covers.
	const pageRef = useRef<DOMElement>(null);
	useMouseLayer(pageRef, page !== "chat");
	const statuses = useAppStore((state) => state.statuses);
	const setStatus = useAppStore((state) => state.setStatus);
	const unsetStatus = useAppStore((state) => state.unsetStatus);

	// A release is only announced, never taken on its own: it is the /update
	// command that replaces the binary this is running from.
	const { update } = useUpdate();

	useEffect(() => {
		if (!update.data) return;
		// biome-ignore lint/nursery/useReactCompiler: this effect synchronizes query data to the external app status store.
		setStatus({
			id: "update",
			text: `v${update.data} available - /update`,
			passive: true,
		});
	}, [update.data, setStatus]);

	const { projects } = useChatList();
	const projectList = projects.data?.pages.flatMap((page) => page.projects);

	useInput((input, key) => {
		if (key.shift && key.tab) {
			// Pages, panels and tool controls own their keys (a tool control
			// cycles its suggestions with it): the shortcut is the editor's.
			if (selectFocus(useAppStore.getState()) !== "editor") return;
			// Something written in the editor takes it to indent and unindent.
			if (!useComposerStore.getState().isEmpty) return;
			ChatService.cycleProject(projectList ?? []);
			return;
		}
		if (key.ctrl && (input === "c" || input === "d")) {
			// Ctrl+C copies a selection, which whatever holds it sees to.
			if (input === "c" && useSelectionStore.getState().holder) return;
			if (statuses.find((status) => status.id === "quit")) {
				// Unmounted rather than killed, so the host decides what quitting does.
				exit();
			} else {
				setStatus({ id: "quit", text: `enter ctrl+${input} again to quit` });
				setTimeout(() => unsetStatus({ id: "quit" }), 2000);
			}
		}
	});

	const draft = useComposerStore((state) => state.data);
	const { chatTokens, categories, usage } = useEstimatedTokens<Color>({
		draft,
		colors: { low: "primary", moderate: "yellowBright", high: "redBright" },
	});

	const panels = useLayoutStore((state) => state.panels);
	const sidebars = columns >= SIDEBAR_COLUMNS;
	const left = sidebars && panels.chats ? panelWidth(columns) : 0;
	const right = sidebars && panels.files ? panelWidth(columns) : 0;
	const width = columns - left - right;
	const panelCount = Number(panels.chats) + Number(panels.files);
	const bottomWidth = Math.floor(columns / Math.max(1, panelCount));

	return (
		<MessageProvider>
			<FindScope
				id={FIND_ROOT}
				label="window"
				region
				ref={rootRef}
				flexDirection="row"
				height={rows}
				backgroundColor="surface"
			>
				{left > 0 && (
					<Box width={left} flexShrink={0} flexDirection="column">
						<AppPanel name="chats">
							<ChatList fill />
						</AppPanel>
					</Box>
				)}
				<WidthContext.Provider value={width}>
					<FindScope
						label="chat"
						region
						segmented
						focus={(focus) => focus === "editor" || focus.startsWith("tool:")}
						flexDirection="column"
						width={width}
						flexShrink={0}
						minHeight={0}
					>
						<Chat compaction={chatTokens.data?.compaction} />
						{/* Held to the bottom whatever opens above it. */}
						<Box flexDirection="column" flexShrink={0}>
							<StatusText />
							{!sidebars && panelCount > 0 && (
								<Box height={Math.floor(rows / 2)} flexShrink={0}>
									{panels.chats && (
										<Box width={bottomWidth} flexDirection="column">
											<AppPanel name="chats">
												<ChatList fill />
											</AppPanel>
										</Box>
									)}
									{panels.files && (
										<Box width={bottomWidth} flexDirection="column">
											<AppPanel name="files">
												<ChatSources fill width={bottomWidth - 2} />
											</AppPanel>
										</Box>
									)}
								</Box>
							)}
							{page === "chat" && <ChatEffects />}
							<Box flexDirection="column">
								{/* A page opens over the chat from the top of the editor, as its
								    completions do, rather than pushing the chat up. */}
								{page !== "chat" && (
									<Box
										ref={pageRef}
										position="absolute"
										bottom="100%"
										left={0}
										right={0}
										flexDirection="column"
									>
										{page === "uploads" && <Uploads />}
										{page === "github" && <GitHub />}
										{page === "memories" && <Memories />}
										{page === "actions" && <Actions />}
										{page === "settings" && <Settings />}
										{page === "config" && <ChatConfig />}
									</Box>
								)}
								<Editor
									disabled={
										page !== "chat" ||
										statuses.some((status) => !status.passive)
									}
									usage={usage}
									categories={categories}
								/>
							</Box>
						</Box>
					</FindScope>
				</WidthContext.Provider>
				{right > 0 && (
					<Box width={right} flexShrink={0} flexDirection="column">
						<AppPanel name="files">
							<ChatSources fill width={right - 2} />
						</AppPanel>
					</Box>
				)}
				<CitationCard />
				{page === "fullscreen" && <ContentFullscreen />}
				{page === "console" && <Console />}
				{/* The keys go to whichever page is up; the fullscreen one has its own bar. */}
				<Find targetRef={rootRef} root={FIND_ROOT} disabled={page !== "chat"} />
			</FindScope>
		</MessageProvider>
	);
}

function AppPanel({
	name,
	children,
}: {
	name: PanelName;
	children: ReactNode;
}) {
	const closePanel = useAppStore((state) => state.closePanel);

	return (
		<FindScope
			label={name}
			region
			focus={(focus) => focus === name}
			flexGrow={1}
			minHeight={0}
		>
			<Panel
				id={name}
				title={name}
				closable
				onClose={() => closePanel(name)}
				flexGrow={1}
				minHeight={0}
				padding={1}
				backgroundColor="interior"
				borderStyle="round"
				border={true}
			>
				{children}
			</Panel>
		</FindScope>
	);
}
