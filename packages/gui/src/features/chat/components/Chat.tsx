import {
	ActionIcon,
	Box,
	type DefaultMantineColor,
	Group,
	ScrollArea,
	Stack,
	Text,
	Transition,
} from "@mantine/core";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { ArrowClockwiseIcon, CaretDoubleDownIcon } from "@phosphor-icons/react";
import { useIsMutating } from "@tanstack/react-query";
import {
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ClientContext } from "#client/client.ts";
import { useGreeting } from "#client/core/hooks/useGreeting.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useDisabled } from "#client/features/editor/hooks/useDisabled.ts";
import { useEstimatedTokens } from "#client/features/editor/hooks/useEstimatedTokens.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { MessageProvider } from "#client/features/message/components/MessageProvider.tsx";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { uploadMutationKey } from "#client/features/upload/hooks/useUploads.ts";
import { useAutoScroll } from "#gui/core/hooks/useAutoScroll.ts";
import { useVirtualList } from "#gui/core/hooks/useVirtualList.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import Actions from "#gui/features/chat/components/Actions.tsx";
import ChatEffects from "#gui/features/chat/components/ChatEffects.tsx";
import ChatHeader from "#gui/features/chat/components/ChatHeader.tsx";
import Editor from "#gui/features/editor/components/Editor.tsx";
import { useEditorStore } from "#gui/features/editor/stores/useEditorStore.ts";
import Message from "#gui/features/message/components/Message.tsx";

export default function Chat() {
	const client = useContext(ClientContext);

	const { chat } = useChat();
	const { messages } = useMessages();
	const draft = useComposerStore((state) => state.data);
	const { chatTokens, usage, categories } =
		useEstimatedTokens<DefaultMantineColor>({
			draft,
			colors: { low: "blue", moderate: "orange", high: "red" },
		});

	useEffect(() => {
		console.log(chatTokens.data);
	}, [chatTokens.data]);

	const createTemporary = useChatStore(
		(s) => s.active.status === "new" && s.active.temporary,
	);
	const createIncognito = useChatStore(
		(s) => s.active.status === "new" && s.active.incognito,
	);
	const scrollInstant = useChatStore((s) => (chat.isFetching ? 0 : s.visits));

	const isMobile = useAppStore((s) => s.isMobile);

	const viewportNode = useRef<HTMLDivElement>(null);
	const focusedMessage = useChatStore((s) =>
		s.active.status === "open" ? s.active.focusedMessage : null,
	);

	const {
		viewportRef: autoScrollRef,
		isAtBottom,
		isLockedToBottom,
		scrollToBottom,
		scrollToNode,
	} = useAutoScroll();

	const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
	const viewportRef = useMergedRef(autoScrollRef, viewportNode, setViewport);

	useLayoutEffect(() => {
		if (scrollInstant > 0) {
			scrollToBottom("instant");
		}
	}, [scrollInstant, scrollToBottom]);

	const editing = useComposerStore((s) =>
		s.mode.kind === "edit" ? s.mode.message : null,
	);
	const insertingAfter = useComposerStore((s) =>
		s.mode.kind === "insert" ? s.mode.after : null,
	);
	const truncating = useComposerStore(
		(s) => s.mode.kind === "edit" && s.mode.truncate,
	);

	const messageList = useMemo(
		() => messages.data?.messages ?? [],
		[messages.data],
	);
	const lastMessageId = messageList.at(-1)?.id;

	// The whole branch is held, but only what is near the viewport is drawn.
	const messageKeys = useMemo(
		() => messageList.map((message) => message.id),
		[messageList],
	);
	const { isMounted, slotProps } = useVirtualList({
		viewport,
		keys: messageKeys,
		atBottom: isLockedToBottom,
	});

	// Waits for the message to be drawn: the chat it is in may still be loading.
	// biome-ignore lint/correctness/useExhaustiveDependencies: messageList re-runs it once the message renders.
	useEffect(() => {
		if (!focusedMessage || chat.isFetching || messages.isFetching) return;
		const node = viewportNode.current?.querySelector(
			// The slot, which is there whether or not the message is drawn.
			`[data-message-slot="${CSS.escape(focusedMessage)}"]`,
		);
		if (!node) return;
		useChatStore.getState().clearFocusedMessage();
		scrollToNode(node);
		node.animate(
			[
				{
					backgroundColor: "var(--mantine-color-blue-light)",
					borderRadius: "var(--mantine-radius-md)",
				},
				{
					backgroundColor: "transparent",
					borderRadius: "var(--mantine-radius-md)",
				},
			],
			{ duration: 1500, easing: "ease-out" },
		);
	}, [
		focusedMessage,
		chat.isFetching,
		messages.isFetching,
		messageList,
		scrollToNode,
	]);

	const messageOpacities = useMemo(() => {
		const map = new Map<string, number>();
		let hasHitEdit = false;
		for (const message of messageList) {
			if (!editing && !insertingAfter) {
				map.set(message.id, 1);
			} else if (message.id === editing?.id) {
				hasHitEdit = true;
				map.set(message.id, 1);
			} else if (
				!hasHitEdit ||
				(message.previousId !== editing?.id && !truncating)
			) {
				map.set(message.id, 0.5);
			} else {
				map.set(message.id, 0.1);
			}
		}
		return map;
	}, [messageList, editing, insertingAfter, truncating]);

	const inputMaxWidth = 860;
	const {
		ref: inputRef,
		width: inputWidth,
		height: inputHeight,
	} = useElementSize();
	const { ref: inputEffectsRef, height: inputEffectsHeight } = useElementSize();
	const { ref: chatContainerRef } = useElementSize();

	const greeting = useGreeting();
	const isNewChat = !chat.data;

	const isUploading = useIsMutating({ mutationKey: uploadMutationKey }) > 0;
	const { disabled } = useDisabled({ disabled: isUploading });

	const _key = useEditorStore((s) => s._key);

	return (
		<Stack h="100%" gap={0}>
			<ChatHeader fixed={true} />
			{/* Main content area */}
			<Box
				flex={1}
				pos="relative"
				mih={0}
				style={{ overflow: "hidden", isolation: "isolate" }}
				ref={chatContainerRef}
			>
				{/* New chat hero overlay */}
				<Stack
					pos="absolute"
					inset={0}
					justify="center"
					align="center"
					gap={0}
					opacity={isNewChat ? 1 : 0}
					style={{
						transition: "opacity 400ms ease",
						pointerEvents: isNewChat ? "auto" : "none",
					}}
				>
					{/* Icon + title: cross-fade between incognito×temporary combinations */}
					<div style={{ display: "grid", placeItems: "center" }}>
						{/* Normal – New Chat */}
						<Stack
							align="center"
							gap={6}
							style={{
								gridArea: "1 / 1",
								opacity: !createIncognito && !createTemporary ? 1 : 0,
								transition: "opacity 300ms ease",
								willChange: "opacity",
								pointerEvents:
									!createIncognito && !createTemporary ? "auto" : "none",
							}}
						>
							<Text size="xl" fw={600} mt={4}>
								{greeting}
							</Text>
						</Stack>
						{/* Normal – Temporary Chat */}
						<Stack
							align="center"
							gap={6}
							style={{
								gridArea: "1 / 1",
								opacity: !createIncognito && createTemporary ? 1 : 0,
								transition: "opacity 300ms ease",
								willChange: "opacity",
								pointerEvents:
									!createIncognito && createTemporary ? "auto" : "none",
							}}
						>
							<Text size="xl" fw={600} mt={4}>
								{greeting}
							</Text>
						</Stack>
						{/* Incognito – New Chat */}
						<Stack
							align="center"
							gap={6}
							style={{
								gridArea: "1 / 1",
								opacity: createIncognito && !createTemporary ? 1 : 0,
								transition: "opacity 300ms ease",
								willChange: "opacity",
								pointerEvents:
									createIncognito && !createTemporary ? "auto" : "none",
							}}
						>
							<Text size="xl" fw={600} mt={4}>
								{greeting}
							</Text>
						</Stack>
						{/* Incognito – Temporary Chat */}
						<Stack
							align="center"
							gap={6}
							style={{
								gridArea: "1 / 1",
								opacity: createIncognito && createTemporary ? 1 : 0,
								transition: "opacity 300ms ease",
								willChange: "opacity",
								pointerEvents:
									createIncognito && createTemporary ? "auto" : "none",
							}}
						>
							<Text size="xl" fw={600} mt={4}>
								{greeting}
							</Text>
						</Stack>
					</div>
					{/* Subtitle: cross-fade between incognito states */}
					<Text
						size="sm"
						c="dimmed"
						style={{
							opacity: createTemporary ? 1 : 0,
							transition: "opacity 300ms ease",
							willChange: "opacity",
							pointerEvents: createTemporary ? "auto" : "none",
						}}
					>
						{createTemporary && "Temporary chat"}
						&nbsp;
					</Text>
				</Stack>

				{/* Messages scroll area */}
				<ScrollArea
					h="100%"
					pos="relative"
					styles={{
						scrollbar: {
							zIndex: "calc(var(--mantine-z-index-app) + 1)",
						},
					}}
					viewportRef={viewportRef}
					style={{
						zIndex: 0,
						opacity: isNewChat ? 0 : 1,
						transition: "opacity 400ms ease",
						pointerEvents: isNewChat ? "none" : "auto",
					}}
					flex={1}
					inset={0}
				>
					<Stack
						pt={isMobile ? 70 : 40}
						px={20}
						m="0 auto"
						maw={860}
						gap={10}
						style={{ paddingBottom: inputHeight }}
					>
						<MessageProvider>
							{messageList.map((message, index) => (
								<div
									key={message.id}
									data-message-slot={message.id}
									{...slotProps(index)}
								>
									{isMounted(index) && (
										<Message
											message={message}
											opacity={messageOpacities.get(message.id) ?? 1}
											isLast={message.id === lastMessageId}
											compaction={chatTokens.data?.compaction}
										/>
									)}
								</div>
							))}
						</MessageProvider>
						<Box mb={20}>
							<Actions />
						</Box>
					</Stack>
				</ScrollArea>
				<div
					style={{
						position: "absolute",
						inset: 0,
						pointerEvents: "none",
						maskImage:
							isMobile || chat.data
								? "linear-gradient(black 0px, transparent 40px)"
								: undefined,
						background:
							isMobile || chat.data ? "var(--mantine-color-body)" : undefined,
					}}
				/>

				<Group
					gap={5}
					style={{
						position: "absolute",
						bottom: inputHeight + inputEffectsHeight + 16,
						right: 20,
						zIndex: "calc(var(--mantine-z-index-app) + 1)",
					}}
				>
					<Transition
						mounted={!isNewChat && !!chat.data?.unseen}
						transition="pop"
						duration={200}
						timingFunction="ease"
					>
						{(styles) => (
							<ActionIcon
								className="glass"
								radius="xl"
								size="lg"
								style={styles}
								onClick={() =>
									chat.data &&
									void ChatService.fetchChat({ client, id: chat.data.id })
								}
								loading={chat.isFetching}
								disabled={chat.isFetching}
							>
								<ArrowClockwiseIcon size={20} />
							</ActionIcon>
						)}
					</Transition>
					<Transition
						mounted={!isAtBottom && !isNewChat}
						transition="slide-up"
						duration={200}
						timingFunction="ease"
					>
						{(styles) => (
							<ActionIcon
								className="glass"
								radius="xl"
								size="lg"
								style={styles}
								onClick={() => {
									scrollToBottom("smooth");
								}}
							>
								<CaretDoubleDownIcon size={20} />
							</ActionIcon>
						)}
					</Transition>
				</Group>

				<ChatEffects
					inputEffectsRef={inputEffectsRef}
					inputMaxWidth={inputMaxWidth}
					bottom={inputHeight}
					disabled={disabled}
				/>

				{/* Input area */}
				<Box
					w="100%"
					maw={inputMaxWidth}
					m="0 auto"
					px={isMobile ? 10 : 20}
					ref={inputRef}
					style={{
						// Clear of the home indicator, which a keyboard covers.
						paddingBottom: `calc(${isMobile ? 10 : 20}px + max(0px, env(safe-area-inset-bottom, 0px) - var(--keyboard-inset, 0px)))`,
						transition: "padding-bottom var(--keyboard-transition, 0s)",
						position: "absolute",
						left: 0,
						right: 0,
						bottom: 0,
						zIndex: "calc(var(--mantine-z-index-app) + 1)",
					}}
				>
					<Editor
						key={_key}
						width={inputWidth}
						bdrs={25}
						disabled={disabled}
						usage={usage}
						categories={categories}
					/>
				</Box>
			</Box>
		</Stack>
	);
}
