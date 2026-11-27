import {
	Box,
	ScrollView,
	type ScrollViewRef,
	Selectable,
	Text,
} from "better-ink-ui";
import { type DOMElement, useBoxMetrics, useInput, useWindowSize } from "ink";
import {
	type ReactNode,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ClientContext } from "#client/client.ts";
import { useChatActions } from "#client/features/chat/hooks/useChatActions.ts";
import { useChatMemories } from "#client/features/chat/hooks/useChatMemories.ts";
import { useChatSources } from "#client/features/chat/hooks/useChatSources.ts";
import { useFileDiff } from "#client/features/chat/hooks/useFileDiff.ts";
import { useFileEditor } from "#client/features/chat/hooks/useFileEditor.ts";
import { useFileViewer } from "#client/features/chat/hooks/useFileViewer.ts";
import { useOpenMessage } from "#client/features/chat/hooks/useOpenMessage.ts";
import {
	useChatSourcesStore,
	type ViewedFile,
} from "#client/features/chat/stores/useChatSourcesStore.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	ChatFile,
	ChatFileChanges,
	ChatFileNode,
	GitRepo,
} from "#client/features/chat/types/chatFiles.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useLaunches } from "#client/features/launch/hooks/useLaunches.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { useActions } from "#client/features/user/hooks/useActions.ts";
import { useMemories } from "#client/features/user/hooks/useMemories.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import type { MemoryState } from "#core/features/data/types/memory.ts";
import type { zLaunch } from "#core/features/data/types/user.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";
import Anchor from "#tui/core/components/Anchor.tsx";
import Completions from "#tui/core/components/Completions.tsx";
import Content, {
	type ContentEdit,
	type ContentFormatter,
} from "#tui/core/components/Content.tsx";
import Divider from "#tui/core/components/Divider.tsx";
import ErrorBoundary from "#tui/core/components/ErrorBoundary.tsx";
import HelpText from "#tui/core/components/HelpText.tsx";
import { usePanel } from "#tui/core/components/Panel.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { WidthContext } from "#tui/core/hooks/useWidth.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import {
	type Launches,
	LaunchPreview,
	LaunchRow,
	useNow,
} from "#tui/features/chat/components/ChatLaunches.tsx";
import { Code } from "#tui/features/code/components/Code.tsx";
import Diff from "#tui/features/code/components/Diff.tsx";
import Markdown from "#tui/features/message/components/Markdown.tsx";
import Image from "#tui/features/part/components/Image.tsx";
import SelectionActions, {
	type SelectionAction,
} from "#tui/features/selection/components/SelectionActions.tsx";

type Preview =
	| { type: "file"; file: ChatFile }
	| { type: "web"; source: zWebContext }
	| { type: "memory"; memory: MemoryState }
	| { type: "action"; action: ActionState }
	| { type: "launch"; launch: zLaunch };

type Row =
	| { type: "node"; node: ChatFileNode; depth: number }
	| { type: "web"; source: zWebContext }
	| { type: "memory"; memory: MemoryState }
	| { type: "action"; action: ActionState }
	| { type: "launch"; launch: zLaunch };

const rowValue = (row: Row) => {
	if (row.type === "launch") return `launch:${row.launch.id}`;
	if (row.type === "node") return row.node.value;
	if (row.type === "web") return `web:${row.source.url}`;
	if (row.type === "memory") return `memory:${row.memory.id}`;
	return `action:${row.action.id}`;
};

/** What the shared store is told is previewed, as a source chip would tell it. */
const viewed = (preview: Preview): Omit<ViewedFile, "chatId"> => {
	if (preview.type === "file")
		return { path: preview.file.path, directory: preview.file.directory };
	if (preview.type === "web")
		return {
			path: `web:${preview.source.url}`,
			web: preview.source,
			directory: false,
		};
	if (preview.type === "memory")
		return { path: `memory:${preview.memory.id}`, directory: false };
	if (preview.type === "launch")
		return { path: `launch:${preview.launch.id}`, directory: false };
	return { path: `action:${preview.action.id}`, directory: false };
};

function Changes({ changes }: { changes: ChatFileChanges }) {
	return (
		<Box flexShrink={0} gap={1}>
			{changes.additions > 0 && (
				<Text color="greenBright">+{changes.additions}</Text>
			)}
			{changes.deletions > 0 && (
				<Text color="redBright">−{changes.deletions}</Text>
			)}
		</Box>
	);
}

/**
 * A preview that is not already a block of its own — a page, a document, a
 * memory — drawn as one, so it can be copied and opened over the whole screen
 * as code is. Padded as code is, which leaves its buttons a row to sit in.
 */
function Block({
	formatter,
	findLabel,
	edit,
	contentId,
	children,
}: {
	formatter: ContentFormatter;
	findLabel: string;
	edit?: ContentEdit;
	contentId?: string;
	children: ReactNode;
}) {
	return (
		<Content
			formatter={formatter}
			findLabel={findLabel}
			edit={edit}
			contentId={contentId}
		>
			<Box flexDirection="column" paddingX={2} paddingY={1}>
				{children}
			</Box>
		</Content>
	);
}

function FilePreview({ file, repos }: { file: ChatFile; repos: GitRepo[] }) {
	const content = useFileViewer({ file });
	const diff = useFileDiff({ file, repos });
	const { save } = useFileEditor({ file });
	const language = FileTypeUtils.getExtension(file);

	// What is on disk, as text: a document's extracted text is not the file.
	const text = diff.data
		? diff.data.after
		: !content.data?.extracted && typeof content.data?.text === "string"
			? content.data.text
			: undefined;
	const edit = useMemo<ContentEdit | undefined>(
		() => (save && text !== undefined ? { value: text, save } : undefined),
		[save, text],
	);
	// The same while open whichever way the file is drawn, so saving a file into
	// a diff (or out of one) keeps it open.
	const contentId = `file:${file.path}`;

	if (diff.data) {
		return (
			<Diff
				before={diff.data.before}
				after={diff.data.after}
				language={language}
				edit={edit}
				contentId={contentId}
			/>
		);
	}
	if (content.isError) {
		return (
			<Text color="redBright">
				{CommonUtils.formatError({ error: content.error })}
			</Text>
		);
	}
	if (!content.data || diff.isLoading) {
		return <Text color="textSubtle">loading…</Text>;
	}
	if (content.data.directory) {
		const items = content.data.items ?? [];
		const names = items.map(
			(item) => `${PathUtils.name(item)}${item.directory ? "/" : ""}`,
		);
		return (
			<Block
				formatter={() => names.join("\n")}
				findLabel={PathUtils.name(file)}
			>
				{names.map((name) => (
					<Text key={name} wrap="truncate-end">
						{name}
					</Text>
				))}
			</Block>
		);
	}
	if (content.data.image) {
		return <Image src={content.data.image} alt={PathUtils.name(file)} />;
	}
	if (
		typeof content.data.text === "string" &&
		(content.data.extracted || FileTypeUtils.isMarkdown(file.path))
	) {
		const prose = content.data.text;
		return (
			<Block
				formatter={() => prose}
				findLabel={PathUtils.name(file)}
				edit={edit}
				contentId={contentId}
			>
				{prose.trim() ? (
					<Markdown source={prose} />
				) : (
					<Text color="textSubtle">nothing written yet</Text>
				)}
			</Block>
		);
	}
	if (!content.data.text) {
		return <Text color="textSubtle">could not decode file</Text>;
	}
	return (
		<Code
			code={content.data.text}
			language={language}
			lineNumbers
			edit={edit}
			contentId={contentId}
		/>
	);
}

function WebPreview({ source }: { source: zWebContext }) {
	return (
		<Block
			formatter={() => source.content}
			findLabel={source.title || URL.parse(source.url)?.hostname || "page"}
		>
			<Box flexDirection="column" gap={1}>
				<Anchor href={source.url} color="textSubtle">
					{source.url}
				</Anchor>
				<Markdown source={source.content} />
			</Box>
		</Block>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Box flexDirection="column">
			<Text color="textSubtle" bold>
				{label}
			</Text>
			{children}
		</Box>
	);
}

function MemoryPreview({ memory }: { memory: MemoryState }) {
	const { fact, evidence, details, learned } = ChatSourcesUtils.memory(memory);
	return (
		<Block
			// As the app copies it: the fact, and what it was learned from quoted.
			formatter={() =>
				[fact, ...evidence.map((item) => `> ${item}`)].join("\n\n")
			}
			findLabel="memory"
		>
			<Box flexDirection="column" gap={1}>
				<Field label="fact">
					<Text>{fact}</Text>
				</Field>
				{evidence.length > 0 && (
					<Field label="evidence">
						{evidence.map((item) => (
							<Text key={item}>
								<Text color="textSubtle">│ </Text>
								{item}
							</Text>
						))}
					</Field>
				)}
				<Box flexDirection="column">
					<Text color="textSubtle">{details}</Text>
					<Text color="textSubtle">{learned}</Text>
				</Box>
			</Box>
		</Block>
	);
}

function ActionPreview({ action }: { action: ActionState }) {
	const { prompt, schedule, lastRun, nextRun } = ChatSourcesUtils.action({
		action,
	});
	return (
		<Block formatter={() => prompt} findLabel="action">
			<Box flexDirection="column" gap={1}>
				<Field label="prompt">
					<Text>{prompt}</Text>
				</Field>
				<Field label="schedule">
					<Text>{schedule}</Text>
				</Field>
				<Box flexDirection="column">
					<Text color="textSubtle">{lastRun}</Text>
					{nextRun && <Text color="textSubtle">{nextRun}</Text>}
				</Box>
			</Box>
		</Block>
	);
}

/**
 * A preview takes the arrows to scroll through itself, and `back` to close.
 * A memory or action takes Return to go to the message it came from.
 */
function PreviewPane({
	preview,
	repos,
	launches,
	fill,
	width,
}: {
	preview: Preview;
	repos: GitRepo[];
	launches: Launches;
	fill: boolean;
	width?: number;
}) {
	const { rows } = useWindowSize();
	const ref = useRef<ScrollViewRef>(null);

	const { messages } = useMessages();
	const lastMessageId = messages.data?.messages.at(-1)?.id;
	let messageId: string | null = null;
	if (preview.type === "memory")
		messageId = ChatSourcesUtils.memory(preview.memory).messageId;
	if (preview.type === "action")
		messageId = ChatSourcesUtils.action({
			action: preview.action,
			lastMessageId,
		}).messageId;
	const { openMessage } = useOpenMessage();
	const openRecord = useAppStore((state) => state.openRecord);

	const { focused } = usePanel();
	useInput(
		(input, key) => {
			if (key.return && messageId && !openMessage.isPending)
				openMessage.mutate(messageId);
			if (input === "e" && preview.type === "memory")
				openRecord("memories", preview.memory.id);
			if (input === "e" && preview.type === "action")
				openRecord("actions", preview.action.id);
			if (preview.type === "launch" && launches.supported) {
				const { launch } = preview;
				const active = LaunchUtils.isActive(launches.statusOf(launch).state);
				if (input === "s" && !launches.isPending(launch))
					launches.control.mutate({
						launch,
						action: active ? "stop" : "start",
					});
				if (input === "r" && active && !launches.isPending(launch))
					launches.control.mutate({ launch, action: "restart" });
			}
			if (key.upArrow) ref.current?.scrollBy(-1);
			if (key.downArrow) ref.current?.scrollBy(1);
		},
		{ isActive: focused },
	);

	const change =
		preview.type === "file"
			? ChatSourcesUtils.changes({ path: preview.file.path, repos })
			: undefined;

	// Text selected in a file or a page is quoted into the message being
	// written, as a passage of a reply is.
	const client = useContext(ClientContext);
	const source =
		preview.type === "file"
			? preview.file.path
			: preview.type === "web"
				? `web:${preview.source.url}`
				: undefined;
	const actions = useMemo<SelectionAction[]>(
		() =>
			source
				? [
						{
							label: "quote",
							onSelect: (text) => {
								ComposerService.insertQuote({ client, source, text });
								useAppStore.getState().setFocus("editor");
							},
						},
					]
				: [],
		[client, source],
	);

	let title: ReactNode;
	let body: ReactNode;
	if (preview.type === "file") {
		title = PathUtils.name(preview.file);
		body = <FilePreview file={preview.file} repos={repos} />;
	} else if (preview.type === "memory") {
		title = "memory";
		body = <MemoryPreview memory={preview.memory} />;
	} else if (preview.type === "action") {
		title = "action";
		body = <ActionPreview action={preview.action} />;
	} else if (preview.type === "launch") {
		title = preview.launch.name;
		body = <LaunchPreview launch={preview.launch} launches={launches} />;
	} else {
		title =
			preview.source.title ||
			URL.parse(preview.source.url)?.hostname ||
			preview.source.url;
		body = <WebPreview source={preview.source} />;
	}

	return (
		<Box
			padding={1}
			flexDirection="column"
			flexGrow={fill ? 1 : 0}
			flexShrink={fill ? 1 : 0}
			minHeight={fill ? 0 : undefined}
		>
			<Box gap={1} paddingBottom={1}>
				<Box flexGrow={1} minWidth={0}>
					<Text bold wrap="truncate-end">
						{title}
					</Text>
				</Box>
				{change && <Changes changes={change} />}
			</Box>
			<WidthContext.Provider value={width ?? null}>
				<ScrollView
					ref={ref}
					paging={focused}
					resetKey={
						preview.type === "file"
							? preview.file.path
							: preview.type === "web"
								? preview.source.url
								: preview.type === "memory"
									? preview.memory.id
									: preview.type === "launch"
										? preview.launch.id
										: preview.action.id
					}
					{...(fill
						? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }
						: { maxHeight: Math.floor(rows / 2) })}
					overscan={Number.POSITIVE_INFINITY}
				>
					<ErrorBoundary label="this preview" resetKey={preview}>
						<SelectionActions actions={actions}>
							<Selectable flexDirection="column">{body}</Selectable>
						</SelectionActions>
					</ErrorBoundary>
				</ScrollView>
			</WidthContext.Provider>
			<HelpText
				actions={[
					{ key: "↑↓", name: "scroll" },
					{
						key: "enter",
						name: openMessage.isPending ? "opening…" : "go to message",
						when: !!messageId,
					},
					{
						key: "e",
						name: "edit",
						when: preview.type === "memory" || preview.type === "action",
					},
					...(preview.type === "launch" && launches.supported
						? [
								{
									key: "s",
									name: LaunchUtils.isActive(
										launches.statusOf(preview.launch).state,
									)
										? "stop"
										: "start",
								},
								{
									key: "r",
									name: "restart",
									when: LaunchUtils.isActive(
										launches.statusOf(preview.launch).state,
									),
								},
							]
						: []),
					"back",
				]}
			/>
		</Box>
	);
}

/**
 * The files and web pages the chat has touched. Files on the machine that sit
 * in a git repository show what changed in them since the last commit, and a
 * changed file previews as its diff.
 */
export default function ChatSources(props: ChatSourcesProps) {
	// What is open and selected starts over with each chat.
	const chatId = useChatStore((state) => state.active.chatId);
	return <ChatSourcesList key={chatId} chatId={chatId} {...props} />;
}

interface ChatSourcesProps {
	/** Drawn as a sidebar, taking the full height it is given. */
	fill?: boolean;
	/** Columns it has, when that is less than the terminal. */
	width?: number;
}

function ChatSourcesList({
	chatId,
	fill = false,
	width,
}: ChatSourcesProps & { chatId: string | null }) {
	const {
		chatFiles,
		files,
		tree,
		webSources: chatWebSources,
		repos,
		loadDirectory,
	} = useChatSources();
	const { chatMemories: ownMemories } = useChatMemories();
	const { chatActions: ownActions } = useChatActions();
	const { memories } = useMemories();
	const { actions } = useActions();
	const launches = useLaunches();
	const now = useNow(
		launches.launches.some((launch) =>
			LaunchUtils.isActive(launches.statusOf(launch).state),
		),
	);
	useWorkingStatus(chatFiles, launches.control);

	// What is previewed is shared with the source chips, which open it from
	// anywhere, as the app's are.
	const viewFile = useChatSourcesStore((state) => state.viewFile);
	const viewedFile = useChatSourcesStore((state) =>
		state.viewedFile?.chatId === chatId ? state.viewedFile : null,
	);
	const setPreview = (preview: Preview | null) =>
		viewFile(preview && { ...viewed(preview), chatId });

	// A page, memory or action opened from a citation stays listed even if no
	// message of this chat has it.
	const viewedWeb = viewedFile?.path.startsWith("web:")
		? (viewedFile.web ??
			chatWebSources.find((source) => source.url === viewedFile.path.slice(4)))
		: undefined;
	const viewedMemory = viewedFile?.path.startsWith("memory:")
		? memories.data?.find((memory) => viewedFile.path === `memory:${memory.id}`)
		: undefined;
	const viewedAction = viewedFile?.path.startsWith("action:")
		? actions.data?.find((action) => viewedFile.path === `action:${action.id}`)
		: undefined;
	const webSources = useMemo(
		() =>
			viewedWeb &&
			!chatWebSources.some((source) => source.url === viewedWeb.url)
				? [...chatWebSources, viewedWeb]
				: chatWebSources,
		[chatWebSources, viewedWeb],
	);
	const chatMemories = useMemo(
		() =>
			viewedMemory && !ownMemories.includes(viewedMemory)
				? [...ownMemories, viewedMemory]
				: ownMemories,
		[ownMemories, viewedMemory],
	);
	const chatActions = useMemo(
		() =>
			viewedAction && !ownActions.includes(viewedAction)
				? [...ownActions, viewedAction]
				: ownActions,
		[ownActions, viewedAction],
	);
	const viewedChatFile = useMemo(
		() =>
			viewedFile &&
			files.find(
				(candidate) =>
					candidate.directory === viewedFile.directory &&
					PathUtils.equals(candidate.path, viewedFile.path),
			),
		[files, viewedFile],
	);
	const viewedLaunch = viewedFile?.path.startsWith("launch:")
		? launches.launches.find(
				(launch) => viewedFile.path === `launch:${launch.id}`,
			)
		: undefined;
	const preview: Preview | null = viewedLaunch
		? { type: "launch", launch: viewedLaunch }
		: viewedWeb
			? { type: "web", source: viewedWeb }
			: viewedMemory
				? { type: "memory", memory: viewedMemory }
				: viewedAction
					? { type: "action", action: viewedAction }
					: viewedChatFile
						? { type: "file", file: viewedChatFile }
						: null;
	// Folders the reader opened or closed. The rest are open only when they are
	// just the way down to something, so the files themselves show at first.
	const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
	const [selected, setSelected] = useState(0);

	const { focused } = usePanel();
	const closePanel = useAppStore((state) => state.closePanel);
	const openRecord = useAppStore((state) => state.openRecord);
	usePage({
		active: focused,
		onBack: () => {
			if (preview) setPreview(null);
			else closePanel("files");
			return false;
		},
	});

	// The folders down to a previewed file are open until closed.
	const viewedParents = useMemo(
		() =>
			new Set(
				viewedChatFile ? ChatSourcesUtils.node(viewedChatFile).parents : [],
			),
		[viewedChatFile],
	);
	const isExpanded = (node: ChatFileNode) =>
		toggled.get(node.value) ?? (!node.file || viewedParents.has(node.value));

	const rows = useMemo<Row[]>(
		() => [
			...launches.launches.map((launch): Row => ({ type: "launch", launch })),
			...ChatSourcesUtils.flatten({
				nodes: tree,
				expanded: (node) =>
					toggled.get(node.value) ??
					(!node.file || viewedParents.has(node.value)),
			}).map((entry): Row => ({ type: "node", ...entry })),
			...webSources.map((source): Row => ({ type: "web", source })),
			...chatMemories.map((memory): Row => ({ type: "memory", memory })),
			...chatActions.map((action): Row => ({ type: "action", action })),
		],
		[
			launches.launches,
			tree,
			toggled,
			viewedParents,
			webSources,
			chatMemories,
			chatActions,
		],
	);
	const byValue = useMemo(
		() => new Map(rows.map((row) => [rowValue(row), row])),
		[rows],
	);

	// A source opened from elsewhere is selected once it is listed.
	const [revealed, setRevealed] = useState<ViewedFile | null>(null);
	if (viewedFile && preview && revealed !== viewedFile) {
		const value =
			preview.type === "file"
				? ChatSourcesUtils.node(preview.file).value
				: viewedFile.path;
		const index = rows.findIndex((row) => rowValue(row) === value);
		if (index !== -1) {
			setRevealed(viewedFile);
			setSelected(index);
		}
	}

	const toggle = (node: ChatFileNode, open = !isExpanded(node)) => {
		if (open && node.file?.local) loadDirectory(node.file);
		setToggled((current) => new Map(current).set(node.value, open));
	};

	// While a preview is open the list stays above it, capped to a share of the
	// height and without the keys, which go to the preview.
	const ref = useRef<DOMElement>(null);
	const { height } = useBoxMetrics(ref);
	const { rows: screenRows } = useWindowSize();
	const listHeight = Math.max(
		3,
		Math.floor((fill ? height : screenRows / 2) * 0.4),
	);
	const selectedIndex = Math.min(selected, Math.max(0, rows.length - 1));
	// The list only follows its selection when the selection moves, so the row
	// a preview was opened from is brought back into view as the list shrinks.
	const listRef = useRef<ScrollViewRef>(null);
	const isPreviewing = !!preview;
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on opening.
	useLayoutEffect(() => {
		if (isPreviewing) listRef.current?.scrollToIndex(selectedIndex);
	}, [isPreviewing]);

	return (
		<Box
			ref={ref}
			flexDirection="column"
			flexGrow={fill ? 1 : 0}
			flexShrink={fill ? 1 : 0}
			minHeight={fill ? 0 : undefined}
			backgroundColor="interior"
		>
			<Completions
				fill={fill && !preview}
				active={preview ? false : undefined}
				help={!preview}
				{...(preview && { maxHeight: listHeight, paddingBottom: 0 })}
				ref={listRef}
				selected={selectedIndex}
				setSelected={(update) => {
					// With a preview open the list only hears presses, and one on it
					// closes the preview, so the list has the keys and presses again.
					if (preview) setPreview(null);
					setSelected(update);
				}}
				selectFirstOnChange={false}
				groups={[
					{
						name: "launches",
						items: launches.launches.map((launch) => ({
							name: launch.name,
							value: `launch:${launch.id}`,
						})),
					},
					{
						name: "files",
						items: rows.flatMap((row) =>
							row.type === "node"
								? [{ name: row.node.label, value: row.node.value }]
								: [],
						),
					},
					{
						name: "web sources",
						items: webSources.map((source) => ({
							name: source.title || source.url,
							value: `web:${source.url}`,
						})),
					},
					{
						name: "memories",
						items: chatMemories.map((memory) => ({
							name: memory.fact,
							value: `memory:${memory.id}`,
						})),
					},
					{
						name: "actions",
						items: chatActions.map((action) => ({
							name: ChatSourcesUtils.action({ action }).prompt,
							value: `action:${action.id}`,
						})),
					},
				]}
				itemProps={{ flexGrow: 1, minWidth: 0 }}
				renderItem={({ item }) => {
					const row = byValue.get(item.value);
					if (row?.type === "launch") {
						return (
							<LaunchRow launch={row.launch} launches={launches} now={now} />
						);
					}
					if (row?.type === "memory") {
						return <Text wrap="truncate-end">{row.memory.fact}</Text>;
					}
					if (row?.type === "action") {
						return (
							<Text wrap="truncate-end">
								{ChatSourcesUtils.action({ action: row.action }).prompt}
							</Text>
						);
					}
					if (row?.type === "web") {
						return (
							<Text wrap="truncate-end">
								{row.source.title ||
									URL.parse(row.source.url)?.hostname ||
									row.source.url}
							</Text>
						);
					}
					if (!row) return item.name ?? "";
					const { node, depth } = row;
					return (
						<Box flexGrow={1} minWidth={0} gap={1}>
							<Box flexGrow={1} minWidth={0}>
								<Text wrap="truncate-end">
									{"  ".repeat(depth)}
									<Text color="textSubtle">
										{node.directory ? (isExpanded(node) ? "▾ " : "▸ ") : "  "}
									</Text>
									{node.label}
									{node.directory && "/"}
								</Text>
							</Box>
							{node.changes && <Changes changes={node.changes} />}
						</Box>
					);
				}}
				onInput={({ item, key }) => {
					const row = item && byValue.get(item.value);
					if (!row) return;
					if (row.type === "launch") {
						if (key.return) setPreview({ type: "launch", launch: row.launch });
						return;
					}
					if (row.type === "web") {
						if (key.return) setPreview({ type: "web", source: row.source });
						return;
					}
					if (row.type === "memory") {
						if (key.return) setPreview({ type: "memory", memory: row.memory });
						return;
					}
					if (row.type === "action") {
						if (key.return) setPreview({ type: "action", action: row.action });
						return;
					}
					const { node } = row;
					if (node.directory) {
						if (key.return) toggle(node);
						if (key.rightArrow) toggle(node, true);
						if (key.leftArrow) toggle(node, false);
						return;
					}
					if (key.return && node.file)
						setPreview({ type: "file", file: node.file });
				}}
				bindings={{
					// Space starts or stops a launch, `r` restarts it.
					toggle: {
						run: (item) => {
							const row = byValue.get(item.value);
							if (row?.type !== "launch" || launches.isPending(row.launch))
								return;
							const active = LaunchUtils.isActive(
								launches.statusOf(row.launch).state,
							);
							launches.control.mutate({
								launch: row.launch,
								action: active ? "stop" : "start",
							});
						},
						when: (item) =>
							launches.supported && item.value.startsWith("launch:"),
					},
					refresh:
						launches.launches.length && launches.supported
							? {
									name: "restart launch",
									run: (item) => {
										const row = item && byValue.get(item.value);
										if (
											row?.type !== "launch" ||
											launches.isPending(row.launch)
										)
											return;
										launches.control.mutate({
											launch: row.launch,
											action: "restart",
										});
									},
								}
							: undefined,
					edit: {
						run: (item) => {
							const row = byValue.get(item.value);
							if (row?.type === "memory") openRecord("memories", row.memory.id);
							if (row?.type === "action") openRecord("actions", row.action.id);
						},
						when: (item) =>
							item.value.startsWith("memory:") ||
							item.value.startsWith("action:"),
					},
				}}
				renderEmpty={() => "nothing here yet"}
				actions={["select", "back"]}
			/>
			{preview && (
				<>
					<Box paddingX={1}>
						<Divider />
					</Box>
					<PreviewPane
						preview={preview}
						repos={repos}
						launches={launches}
						fill={fill}
						width={width}
					/>
				</>
			)}
		</Box>
	);
}
