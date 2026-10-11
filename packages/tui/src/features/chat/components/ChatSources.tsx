import { type DOMElement, useBoxMetrics, useInput, useWindowSize } from "ink";
import {
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useChatActions } from "#client/features/chat/hooks/useChatActions.ts";
import { useChatMemories } from "#client/features/chat/hooks/useChatMemories.ts";
import { useChatSources } from "#client/features/chat/hooks/useChatSources.ts";
import { useFileDiff } from "#client/features/chat/hooks/useFileDiff.ts";
import { useFileViewer } from "#client/features/chat/hooks/useFileViewer.ts";
import { useOpenMessage } from "#client/features/chat/hooks/useOpenMessage.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	ChatFile,
	ChatFileChanges,
	ChatFileNode,
	GitRepo,
} from "#client/features/chat/types/chatFiles.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import type { MemoryState } from "#core/features/data/types/memory.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import Anchor from "#tui/core/components/Anchor.tsx";
import Box from "#tui/core/components/Box.tsx";
import Divider from "#tui/core/components/Divider.tsx";
import HelpText from "#tui/core/components/HelpText.tsx";
import { usePanel } from "#tui/core/components/Panel.tsx";
import ScrollView, {
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { WidthContext } from "#tui/core/hooks/useWidth.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import { Code } from "#tui/features/code/components/Code.tsx";
import Diff from "#tui/features/code/components/Diff.tsx";
import Completions from "#tui/features/editor/components/Completions.tsx";
import Markdown from "#tui/features/message/components/Markdown.tsx";
import Image from "#tui/features/part/components/Image.tsx";

/** Lines of a file drawn in its preview; past this it is cut short. */
const MAX_LINES = 2000;

type Preview =
	| { type: "file"; file: ChatFile }
	| { type: "web"; source: zWebContext }
	| { type: "memory"; memory: MemoryState }
	| { type: "action"; action: ActionState };

type Row =
	| { type: "node"; node: ChatFileNode; depth: number }
	| { type: "web"; source: zWebContext }
	| { type: "memory"; memory: MemoryState }
	| { type: "action"; action: ActionState };

const rowValue = (row: Row) => {
	if (row.type === "node") return row.node.value;
	if (row.type === "web") return `web:${row.source.url}`;
	if (row.type === "memory") return `memory:${row.memory.id}`;
	return `action:${row.action.id}`;
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

function FilePreview({ file, repos }: { file: ChatFile; repos: GitRepo[] }) {
	const content = useFileViewer({ file });
	const diff = useFileDiff({ file, repos });
	const language = FileTypeUtils.getExtension(file);

	if (diff.data) {
		return (
			<Diff
				before={diff.data.before}
				after={diff.data.after}
				language={language}
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
		return (
			<Box flexDirection="column">
				{content.data.items?.map((item) => (
					<Text key={item.path} wrap="truncate-end">
						{PathUtils.name(item)}
						{item.directory && "/"}
					</Text>
				))}
			</Box>
		);
	}
	if (content.data.image) {
		return <Image src={content.data.image} alt={PathUtils.name(file)} />;
	}
	if (!content.data.text) {
		return <Text color="textSubtle">could not decode file</Text>;
	}
	if (content.data.extracted) {
		return <Markdown source={content.data.text} />;
	}
	const lines = content.data.text.split("\n");
	return (
		<Box flexDirection="column">
			<Code
				code={lines.slice(0, MAX_LINES).join("\n")}
				language={language}
				lineNumbers
			/>
			{lines.length > MAX_LINES && (
				<Text color="textSubtle">
					{` ⋮ ${lines.length - MAX_LINES} more lines`}
				</Text>
			)}
		</Box>
	);
}

function WebPreview({ source }: { source: zWebContext }) {
	return (
		<Box flexDirection="column" gap={1}>
			<Anchor href={source.url} color="textSubtle">
				{source.url}
			</Anchor>
			<Markdown source={source.content} />
		</Box>
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
	);
}

function ActionPreview({ action }: { action: ActionState }) {
	const { prompt, schedule, lastRun, nextRun } = ChatSourcesUtils.action({
		action,
	});
	return (
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
	);
}

/**
 * A preview takes the arrows to scroll through itself, and `back` to close.
 * A memory or action takes Return to go to the message it came from.
 */
function PreviewPane({
	preview,
	repos,
	fill,
	width,
}: {
	preview: Preview;
	repos: GitRepo[];
	fill: boolean;
	width?: number;
}) {
	const { rows } = useWindowSize();
	const ref = useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);

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

	const { focused } = usePanel();
	useInput(
		(_input, key) => {
			if (key.return && messageId && !openMessage.isPending)
				openMessage.mutate(messageId);
			const page = Math.max(1, (ref.current?.getViewportHeight() ?? 1) - 2);
			if (key.upArrow) ref.current?.scrollBy(-1);
			if (key.downArrow) ref.current?.scrollBy(1);
			if (key.pageUp) ref.current?.scrollBy(-page);
			if (key.pageDown) ref.current?.scrollBy(page);
		},
		{ isActive: focused },
	);

	const change =
		preview.type === "file"
			? ChatSourcesUtils.changes({ path: preview.file.path, repos })
			: undefined;

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
					resetKey={
						preview.type === "file"
							? preview.file.path
							: preview.type === "web"
								? preview.source.url
								: preview.type === "memory"
									? preview.memory.id
									: preview.action.id
					}
					{...(fill
						? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }
						: { maxHeight: Math.floor(rows / 2) })}
					overscan={Number.POSITIVE_INFINITY}
				>
					{body}
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
	return <ChatSourcesList key={chatId} {...props} />;
}

interface ChatSourcesProps {
	/** Drawn as a sidebar, taking the full height it is given. */
	fill?: boolean;
	/** Columns it has, when that is less than the terminal. */
	width?: number;
}

function ChatSourcesList({ fill = false, width }: ChatSourcesProps) {
	const { chatFiles, tree, webSources, repos, loadDirectory } =
		useChatSources();
	const { chatMemories } = useChatMemories();
	const { chatActions } = useChatActions();
	useWorkingStatus(chatFiles);

	const [preview, setPreview] = useState<Preview | null>(null);
	// Folders the reader opened or closed. The rest are open only when they are
	// just the way down to something, so the files themselves show at first.
	const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
	const [selected, setSelected] = useState(0);

	const { focused } = usePanel();
	const closePanel = useAppStore((state) => state.closePanel);
	usePage({
		active: focused,
		onBack: () => {
			if (preview) setPreview(null);
			else closePanel("files");
			return false;
		},
	});

	const isExpanded = (node: ChatFileNode) =>
		toggled.get(node.value) ?? !node.file;

	const rows = useMemo<Row[]>(
		() => [
			...ChatSourcesUtils.flatten({
				nodes: tree,
				expanded: (node) => toggled.get(node.value) ?? !node.file,
			}).map((entry): Row => ({ type: "node", ...entry })),
			...webSources.map((source): Row => ({ type: "web", source })),
			...chatMemories.map((memory): Row => ({ type: "memory", memory })),
			...chatActions.map((action): Row => ({ type: "action", action })),
		],
		[tree, toggled, webSources, chatMemories, chatActions],
	);
	const byValue = useMemo(
		() => new Map(rows.map((row) => [rowValue(row), row])),
		[rows],
	);

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
	const listRef = useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);
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
				setSelected={(update) => setSelected(update)}
				selectFirstOnChange={false}
				groups={[
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
						fill={fill}
						width={width}
					/>
				</>
			)}
		</Box>
	);
}
