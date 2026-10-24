import { AppShell, LoadingOverlay, MantineProvider } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { ModalsProvider, useModals } from "@mantine/modals";
import { useDrag } from "@use-gesture/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrepareCode } from "#client/core/hooks/useCode.ts";
import { usePersistedPanels } from "#client/core/hooks/usePersistedPanels.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { useDefaultProject } from "#client/features/chat/hooks/useDefaultProject.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { useThemes } from "#client/features/settings/hooks/useThemes.ts";
import Console from "#gui/core/components/Console.tsx";
import Tasks from "#gui/core/components/Tasks.tsx";
import { useExperiments } from "#gui/core/hooks/useExperiments.tsx";
import { setHashbangQuery, useHashbang } from "#gui/core/hooks/useHashbang.ts";
import { usePanelSwipe } from "#gui/core/hooks/usePanelSwipe.ts";
import { useViewport } from "#gui/core/hooks/useViewport.ts";
import { AppService } from "#gui/core/services/AppService.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import Chat from "#gui/features/chat/components/Chat.tsx";
import ChatSources from "#gui/features/chat/components/ChatSources.tsx";
import Find from "#gui/features/find/components/Find.tsx";
import FindScope from "#gui/features/find/components/FindScope.tsx";
import Sidebar from "#gui/features/sidebar/components/Sidebar.tsx";
import mantineTheme, { cssResolver } from "#gui/theme.tsx";

/**
 * Shift+tab leaves the current chat and cycles projects, matching the CLI. It
 * stands down while a drawer or modal is open, and while the editor has
 * anything in it, which takes the key to unindent. Rendered inside
 * `ModalsProvider` so confirm modals count too.
 */
function ProjectShortcut() {
	const { projects } = useChatList();
	const { modals } = useModals();

	useHotkeys(
		[
			[
				"shift+Tab",
				(event) => {
					const { currentDrawer, currentModal } = useAppStore.getState();
					if (currentDrawer || currentModal || modals.length) return;
					if (!useComposerStore.getState().isEmpty) return;
					event.preventDefault();
					ChatService.cycleProject(
						projects.data?.pages.flatMap((page) => page.projects) ?? [],
					);
				},
			],
		],
		[],
		true,
	);
	return null;
}

/** The scope of the whole window, searched once nothing narrower is. */
const FIND_ROOT = "app";

export default function App() {
	const { query } = useHashbang();
	const { session } = useSession({
		token: {
			value: query.token ? decodeURIComponent(query.token) : undefined,
			onChange: () => setHashbangQuery({ token: undefined }),
		},
		clone: {
			value: query.clone ? decodeURIComponent(query.clone) : undefined,
			onChange: () => setHashbangQuery({ clone: undefined }),
		},
	});
	useExperiments();
	const { height: viewportHeight, containerRef } = useViewport();
	// What the keyboard leaves of the viewport; see `useViewport`.
	const appHeight = `calc(${viewportHeight}px - var(--keyboard-inset, 0px))`;
	const keyboardTransition = (property: string) =>
		`${property} var(--keyboard-transition, 0s)`;
	const { theme } = useThemes();
	usePrepareCode();
	useDefaultProject();

	const isMobile = useAppStore((s) => s.isMobile);
	const isSidebarOpen = useLayoutStore((s) => s.panels.chats);
	const setPanel = useLayoutStore((s) => s.setPanel);
	const sidebarWidth = useAppStore((s) => s.sidebarWidth);
	const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
	const isAsideOpen = useLayoutStore((s) => s.panels.files);
	const asideWidth = useAppStore((s) => s.asideWidth);
	const setAsideWidth = useAppStore((s) => s.setAsideWidth);
	const [isResizingSidebar, setIsResizingSidebar] = useState(false);
	const [isResizingAside, setIsResizingAside] = useState(false);
	const appShellRef = useRef<HTMLDivElement>(null);
	const sidebarResizeHandleRef = useRef<HTMLDivElement>(null);
	const asideResizeHandleRef = useRef<HTMLDivElement>(null);
	const navbarRef = useRef<HTMLDivElement>(null);
	const asideRef = useRef<HTMLDivElement>(null);

	useEffect(() => AppService.initialize(), []);
	// Opened over the chat on a phone, rather than beside it, so not reopened.
	usePersistedPanels({ restore: !AppService.isMobile });
	usePanelSwipe({ navbarRef, asideRef });

	const dragSidebarResize = useDrag(
		({ first, last, xy: [pointerX] }) => {
			if (first) {
				setIsResizingSidebar(true);
				setPanel("chats", true);
			}
			const closedWidth = 60;
			const width = Math.min(
				window.innerWidth,
				Math.max(closedWidth, pointerX),
			);
			const expandedOpacity = Math.min(
				1,
				Math.max(0, (width - closedWidth) / (300 - closedWidth)),
			);
			if (sidebarResizeHandleRef.current)
				sidebarResizeHandleRef.current.style.left = `${width - 7}px`;
			if (appShellRef.current) {
				appShellRef.current.style.setProperty(
					"--app-shell-navbar-width",
					`${width}px`,
				);
				appShellRef.current.style.setProperty(
					"--app-shell-navbar-offset",
					`${width}px`,
				);
				appShellRef.current.style.setProperty(
					"--sidebar-expanded-opacity",
					`${expandedOpacity}`,
				);
				appShellRef.current.style.setProperty(
					"--sidebar-collapsed-opacity",
					`${1 - expandedOpacity}`,
				);
				appShellRef.current.style.setProperty(
					"--sidebar-expanded-visibility",
					"visible",
				);
				appShellRef.current.style.setProperty(
					"--sidebar-collapsed-visibility",
					"visible",
				);
				appShellRef.current.style.setProperty(
					"--sidebar-opacity-transition",
					"none",
				);
			}

			if (last) {
				const staysOpen = width > 300;
				if (staysOpen) setSidebarWidth(width);
				setPanel("chats", staysOpen);
				setIsResizingSidebar(false);
			}
		},
		{ axis: "x", filterTaps: true },
	);
	const dragAsideResize = useDrag(
		({ first, last, xy: [pointerX] }) => {
			if (first) {
				setIsResizingAside(true);
				setPanel("files", true);
			}
			const width = Math.min(
				window.innerWidth,
				Math.max(0, window.innerWidth - pointerX),
			);
			if (asideResizeHandleRef.current)
				asideResizeHandleRef.current.style.right = `${width - 7}px`;
			if (appShellRef.current) {
				appShellRef.current.style.setProperty(
					"--app-shell-aside-width",
					`${width}px`,
				);
				appShellRef.current.style.setProperty(
					"--app-shell-aside-offset",
					`${width}px`,
				);
			}

			if (last) {
				const staysOpen = width > 300;
				if (staysOpen) setAsideWidth(width);
				setPanel("files", staysOpen);
				setIsResizingAside(false);
			}
		},
		{ axis: "x", filterTaps: true },
	);
	useEffect(() => {
		document.body.classList.toggle(
			"unselectable",
			isResizingSidebar || isResizingAside,
		);
	}, [isResizingAside, isResizingSidebar]);
	useLayoutEffect(() => {
		if (isResizingSidebar) return;
		appShellRef.current?.style.removeProperty("--app-shell-navbar-width");
		appShellRef.current?.style.removeProperty("--app-shell-navbar-offset");
		appShellRef.current?.style.removeProperty("--sidebar-expanded-opacity");
		appShellRef.current?.style.removeProperty("--sidebar-collapsed-opacity");
		appShellRef.current?.style.removeProperty("--sidebar-expanded-visibility");
		appShellRef.current?.style.removeProperty("--sidebar-collapsed-visibility");
		appShellRef.current?.style.removeProperty("--sidebar-opacity-transition");
		if (sidebarResizeHandleRef.current) {
			sidebarResizeHandleRef.current.style.left = isSidebarOpen
				? `${sidebarWidth - 7}px`
				: "53px";
		}
	}, [isResizingSidebar, isSidebarOpen, sidebarWidth]);
	useLayoutEffect(() => {
		if (isResizingAside) return;
		appShellRef.current?.style.removeProperty("--app-shell-aside-width");
		appShellRef.current?.style.removeProperty("--app-shell-aside-offset");
		if (asideResizeHandleRef.current) {
			asideResizeHandleRef.current.style.right = isAsideOpen
				? `${asideWidth - 7}px`
				: "0px";
		}
	}, [asideWidth, isAsideOpen, isResizingAside]);

	return (
		<MantineProvider
			theme={mantineTheme}
			forceColorScheme={theme}
			cssVariablesResolver={cssResolver}
		>
			<ModalsProvider>
				<Tasks />
				<ProjectShortcut />
				<FindScope
					id={FIND_ROOT}
					label="Window"
					region
					pos="relative"
					ref={containerRef}
					style={{
						height: appHeight,
						transition: keyboardTransition("height"),
					}}
				>
					<LoadingOverlay
						visible={session.isPending}
						zIndex={1000}
						overlayProps={{ blur: 2 }}
					/>
					<Find root={FIND_ROOT} />
					<AppShell
						ref={appShellRef}
						withBorder={false}
						navbar={{
							width: isMobile ? "100%" : isSidebarOpen ? sidebarWidth : 60,
							breakpoint: AppService.breakpoint,
							collapsed: { desktop: false, mobile: !isSidebarOpen },
						}}
						aside={{
							width: isMobile ? "100%" : asideWidth,
							breakpoint: AppService.breakpoint,
							collapsed: { desktop: !isAsideOpen, mobile: !isAsideOpen },
						}}
						style={{
							height: appHeight,
							maxHeight: appHeight,
							transition: [
								keyboardTransition("height"),
								keyboardTransition("max-height"),
							].join(", "),
							overflow: "hidden",
							//*REVERT?* transform: `translateY(${viewport.offsetTop}px)`,
						}}
						styles={{
							navbar: {
								zIndex: "calc(var(--mantine-z-index-app) + 2)",
								transition: isResizingSidebar
									? "width 0ms, min-width 0ms, transform 300ms ease"
									: "width 250ms ease, min-width 250ms ease, transform 300ms ease",
							},
							aside: {
								zIndex: "calc(var(--mantine-z-index-app) + 2)",
								transition: isResizingAside
									? "width 0ms, min-width 0ms, transform 300ms ease"
									: "width 250ms ease, min-width 250ms ease, transform 300ms ease",
							},
							main: {
								transition: [
									isResizingSidebar || isResizingAside
										? "padding-inline-start 0ms, padding-inline-end 0ms"
										: "padding-inline-start 250ms ease, padding-inline-end 250ms ease",
									keyboardTransition("height"),
									keyboardTransition("max-height"),
								].join(", "),
							},
						}}
					>
						{/* On mobile, panels are swiped instead; see `usePanelSwipe`. */}
						{!isMobile && (
							<div
								ref={sidebarResizeHandleRef}
								{...dragSidebarResize()}
								style={{
									position: "absolute",
									top: 0,
									left: isSidebarOpen ? sidebarWidth - 7 : 53,
									bottom: 0,
									width: 15,
									zIndex: "var(--mantine-z-index-max)",
									touchAction: "none",
									cursor: "ew-resize",
								}}
							/>
						)}
						{!isMobile && (
							<div
								ref={asideResizeHandleRef}
								{...dragAsideResize()}
								style={{
									position: "absolute",
									top: 0,
									right: isAsideOpen ? asideWidth - 7 : 0,
									bottom: 0,
									width: 15,
									zIndex: "var(--mantine-z-index-max)",
									touchAction: "none",
									cursor: "ew-resize",
								}}
							/>
						)}
						<AppShell.Navbar
							ref={navbarRef}
							style={{
								padding: 10,
								paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
								paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
								paddingLeft: "calc(10px + env(safe-area-inset-left, 0px))",
								paddingRight: "calc(10px + env(safe-area-inset-right, 0px))",
								touchAction: "pan-y",
								fontWeight: 450,
							}}
							withBorder
						>
							<FindScope label="Chats" region pos="relative" h="100%">
								<Sidebar />
							</FindScope>
						</AppShell.Navbar>
						<AppShell.Main
							style={{
								height: appHeight,
								maxHeight: appHeight,
								minHeight: 0,
								overflow: "hidden",
								// The header paints behind the notch and the chat runs under the home
								// indicator; keep chat content in the safe area. The composer takes the
								// bottom inset itself.
								paddingTop: "env(safe-area-inset-top, 0px)",
								paddingLeft: isMobile
									? "env(safe-area-inset-left, 0px)"
									: "calc(var(--app-shell-navbar-offset, 0px) + env(safe-area-inset-left, 0px))",
								paddingRight: isMobile
									? "env(safe-area-inset-right, 0px)"
									: "calc(var(--app-shell-aside-offset, 0px) + env(safe-area-inset-right, 0px))",
							}}
						>
							<Chat />
						</AppShell.Main>
						<AppShell.Aside
							ref={asideRef}
							style={{
								padding: 10,
								paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
								paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
								paddingLeft: "calc(10px + env(safe-area-inset-left, 0px))",
								paddingRight: "calc(10px + env(safe-area-inset-right, 0px))",
								touchAction: "pan-y",
								fontWeight: 450,
							}}
							withBorder
						>
							<FindScope label="Sources" region pos="relative" h="100%">
								<ChatSources />
							</FindScope>
						</AppShell.Aside>
					</AppShell>
				</FindScope>
				<Console />
			</ModalsProvider>
		</MantineProvider>
	);
}
