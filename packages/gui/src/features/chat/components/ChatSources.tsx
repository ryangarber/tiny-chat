import {
	ActionIcon,
	Box,
	Burger,
	Button,
	Divider,
	Group,
	Loader,
	type RenderTreeNodePayload,
	ScrollArea,
	Skeleton,
	Stack,
	Text,
	Tree,
	type TreeNodeData,
	useTree,
} from "@mantine/core";
import {
	CaretDownIcon,
	CaretLeftIcon,
	CaretRightIcon,
	ChatTextIcon,
	PencilSimpleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { BundledLanguage } from "streamdown";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { useChatActions } from "#client/features/chat/hooks/useChatActions.ts";
import { useChatMemories } from "#client/features/chat/hooks/useChatMemories.ts";
import { useChatSources } from "#client/features/chat/hooks/useChatSources.ts";
import { useFileDiff } from "#client/features/chat/hooks/useFileDiff.ts";
import { useFileViewer } from "#client/features/chat/hooks/useFileViewer.ts";
import { useOpenMessage } from "#client/features/chat/hooks/useOpenMessage.ts";
import { useChatSourcesStore } from "#client/features/chat/stores/useChatSourcesStore.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	ChatFile,
	ChatFileChanges,
	ChatFileNode,
	GitRepo,
} from "#client/features/chat/types/chatFiles.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { useActions } from "#client/features/user/hooks/useActions.ts";
import { useMemories } from "#client/features/user/hooks/useMemories.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import type { MemoryState } from "#core/features/data/types/memory.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import { AppService } from "#gui/core/services/AppService.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import Code from "#gui/features/code/components/Code.tsx";
import Diff from "#gui/features/code/components/Diff.tsx";
import FindScope from "#gui/features/find/components/FindScope.tsx";
import Markdown from "#gui/features/message/components/Markdown.tsx";
import Image from "#gui/features/part/components/Image.tsx";
import SourceChip from "#gui/features/part/components/SourceChip.tsx";
import Web from "#gui/features/part/components/Web.tsx";

interface FileTreeNodeProps {
	node: ChatFileNode;
}

function toTreeData(nodes: ChatFileNode[]): TreeNodeData[] {
	return nodes.map((node) => ({
		value: node.value,
		label: node.label,
		nodeProps: { node } satisfies FileTreeNodeProps,
		children: toTreeData(node.children),
	}));
}

function Changes({ changes }: { changes: ChatFileChanges }) {
	return (
		<Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
			{changes.additions > 0 && (
				<Text size="xs" c="green" ff="monospace">
					+{changes.additions}
				</Text>
			)}
			{changes.deletions > 0 && (
				<Text size="xs" c="red" ff="monospace">
					−{changes.deletions}
				</Text>
			)}
		</Group>
	);
}

function FilePreview({ file, repos }: { file: ChatFile; repos: GitRepo[] }) {
	const content = useFileViewer({ file });
	const diff = useFileDiff({ file, repos });
	const language = (FileTypeUtils.getExtension(file) ?? undefined) as
		| BundledLanguage
		| undefined;
	if (diff.data) {
		return (
			<Diff
				filename={file.path}
				language={language}
				before={diff.data.before}
				after={diff.data.after}
				maw="100%"
				h="100%"
				fillHeight
			/>
		);
	}
	if (content.isError) {
		return (
			<Text c="red">{CommonUtils.formatError({ error: content.error })}</Text>
		);
	}
	if (!content.data || diff.isLoading) {
		return <Skeleton width="100%" height="auto" style={{ aspectRatio: 2 }} />;
	}
	if (content.data.directory) {
		return (
			<Stack gap={5}>
				{content.data.items?.map((item) => (
					<SourceChip
						key={item.path}
						path={item.path}
						directory={item.directory}
					>
						<Text size="sm" truncate>
							{PathUtils.name(item)}
							{item.directory && "/"}
						</Text>
					</SourceChip>
				)) ?? <Loader size="xs" my="md" />}
			</Stack>
		);
	}
	if (content.data.image) {
		return <Image src={content.data.image} filename={file.path} />;
	}
	if (!content.data.text) {
		return (
			<Code
				filename={file.path}
				code="// could not decode file"
				maw="100%"
				h="100%"
				fillHeight
			/>
		);
	}
	return content.data.extracted ? (
		<Markdown source={content.data.text} />
	) : (
		<Code
			filename={file.path}
			language={FileTypeUtils.getExtension(file) as BundledLanguage}
			code={content.data.text}
			maw="100%"
			h="100%"
			fillHeight
		/>
	);
}

function PreviewPane({
	title,
	onClose,
	children,
}: {
	title?: string;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<Stack flex={1} mih={0} gap="xs">
			<Group gap={4} wrap="nowrap">
				<ActionIcon
					variant="subtle"
					aria-label="Close preview"
					onClick={onClose}
				>
					<CaretLeftIcon size={18} />
				</ActionIcon>
				{title && (
					<Text size="xs" fw={600} flex={1} miw={0} truncate title={title}>
						{title}
					</Text>
				)}
			</Group>
			<FindScope
				label={title ?? "Preview"}
				region
				flex={1}
				mih={0}
				pos="relative"
			>
				{children}
			</FindScope>
		</Stack>
	);
}

function GoToMessage({ id }: { id: string }) {
	const { openMessage } = useOpenMessage();
	const isMobile = useAppStore((state) => state.isMobile);
	const setPanel = useLayoutStore((state) => state.setPanel);
	return (
		<Button
			variant="light"
			size="xs"
			leftSection={<ChatTextIcon size={16} />}
			loading={openMessage.isPending}
			onClick={() => {
				// Close up front: the message may be in another chat, which unmounts
				// this button before the mutation settles.
				if (isMobile) setPanel("files", false);
				openMessage.mutate(id);
			}}
		>
			Go to message
		</Button>
	);
}

/** Opens a memory or action where it is edited, scrolled to. */
function EditButton({ type, id }: { type: "memory" | "action"; id: string }) {
	return (
		<Button
			variant="light"
			size="xs"
			leftSection={<PencilSimpleIcon size={16} />}
			onClick={() =>
				type === "memory"
					? AppService.openMemories(id)
					: AppService.openActions(id)
			}
		>
			Edit
		</Button>
	);
}

/** The same, as an icon beside the source in the list. */
function EditIcon({ type, id }: { type: "memory" | "action"; id: string }) {
	return (
		<ActionIcon
			variant="subtle"
			size="sm"
			color="gray"
			aria-label={`Edit ${type}`}
			onClick={() =>
				type === "memory"
					? AppService.openMemories(id)
					: AppService.openActions(id)
			}
		>
			<PencilSimpleIcon size={14} />
		</ActionIcon>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack gap={2}>
			<Text size="xs" c="dimmed" fw={600}>
				{label}
			</Text>
			{children}
		</Stack>
	);
}

function MemoryPreview({ memory }: { memory: MemoryState }) {
	const { fact, evidence, details, learned, messageId } =
		ChatSourcesUtils.memory(memory);
	return (
		<Stack gap="sm">
			<Field label="Fact">
				<Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
					{fact}
				</Text>
			</Field>
			{evidence.length > 0 && (
				<Field label="Evidence">
					<Stack gap={4}>
						{evidence.map((item) => (
							<Text
								key={item}
								size="sm"
								pl="xs"
								style={{
									whiteSpace: "pre-wrap",
									borderLeft: "2px solid var(--mantine-color-default-border)",
								}}
							>
								{item}
							</Text>
						))}
					</Stack>
				</Field>
			)}
			<Text size="xs" c="dimmed">
				{details}
				<br />
				{learned}
			</Text>
			<Group gap="xs">
				<EditButton type="memory" id={memory.id} />
				{messageId && <GoToMessage id={messageId} />}
			</Group>
		</Stack>
	);
}

function ActionPreview({
	action,
	lastMessageId,
}: {
	action: ActionState;
	lastMessageId?: string;
}) {
	const { prompt, schedule, lastRun, nextRun, messageId } =
		ChatSourcesUtils.action({ action, lastMessageId });
	return (
		<Stack gap="sm">
			<Field label="Prompt">
				<Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
					{prompt}
				</Text>
			</Field>
			<Field label="Schedule">
				<Text size="sm">{schedule}</Text>
			</Field>
			<Text size="xs" c="dimmed">
				{lastRun}
				{nextRun && (
					<>
						<br />
						{nextRun}
					</>
				)}
			</Text>
			<Group gap="xs">
				<EditButton type="action" id={action.id} />
				{messageId && <GoToMessage id={messageId} />}
			</Group>
		</Stack>
	);
}

function FileTreeNode({
	node,
	expanded,
	elementProps,
	onLoadDirectory,
	onPreview,
	highlighted,
}: RenderTreeNodePayload & {
	onLoadDirectory: (file: ChatFile) => void;
	onPreview: (file: ChatFile) => void;
	highlighted: boolean;
}) {
	const { node: fileNode } = node.nodeProps as FileTreeNodeProps;
	const file = fileNode.file;
	const directory = fileNode.directory;
	return (
		<Group
			gap={5}
			py={4}
			{...elementProps}
			onClick={(event) => {
				elementProps.onClick?.(event);
				if (directory && file?.local && !expanded) onLoadDirectory(file);
				if (!directory && file) onPreview(file);
			}}
			wrap="nowrap"
			style={{
				...elementProps.style,
				backgroundColor: highlighted
					? "var(--mantine-color-blue-light)"
					: "transparent",
				borderRadius: "var(--mantine-radius-sm)",
				transition: "background-color 900ms ease-out",
			}}
		>
			{expanded ? (
				<CaretDownIcon
					size={16}
					style={{ opacity: directory ? 1 : 0, flexShrink: 0 }}
				/>
			) : (
				<CaretRightIcon
					size={16}
					style={{ opacity: directory ? 1 : 0, flexShrink: 0 }}
				/>
			)}
			<SourceChip
				path={file?.path ?? String(node.label)}
				directory={directory}
				expanded={expanded}
				viewable={false}
				flex={1}
			>
				<Text size="sm" flex={1} miw={0} truncate>
					{String(node.label)}
					{directory && "/"}
				</Text>
			</SourceChip>
			{fileNode.changes && <Changes changes={fileNode.changes} />}
		</Group>
	);
}

export default function ChatSources() {
	const {
		chatFiles,
		files,
		tree: fileTree,
		webSources: chatWebSources,
		repos,
		loadDirectory,
	} = useChatSources();
	const { chatMemories: ownMemories } = useChatMemories();
	const { chatActions: ownActions } = useChatActions();
	const { memories } = useMemories();
	const { actions } = useActions();
	const { messages } = useMessages();
	const lastMessageId = messages.data?.messages.at(-1)?.id;
	const chatId = useChatStore((state) => state.active.chatId);
	const isAsideOpen = useLayoutStore((state) => state.panels.files);
	const setPanel = useLayoutStore((state) => state.setPanel);
	const viewFile = useChatSourcesStore((state) => state.viewFile);
	const viewedFile = useChatSourcesStore((state) => {
		if (!state.viewedFile) return null;
		if (state.viewedFile.chatId !== chatId) return null;
		return state.viewedFile;
	});
	const tree = useTree();
	const treeRef = useRef(tree);
	const treeViewport = useRef<HTMLDivElement>(null);
	const processedViewedFile = useRef<typeof viewedFile>(null);
	const highlightFrame = useRef<number>(undefined);
	const highlightTimeout = useRef<number>(undefined);
	const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
	useEffect(() => {
		treeRef.current = tree;
	}, [tree]);

	// A page opened from a citation stays listed even if no message has it.
	const webSources = useMemo(
		() =>
			viewedFile?.web &&
			!chatWebSources.some((source) => source.url === viewedFile.web?.url)
				? [...chatWebSources, viewedFile.web]
				: chatWebSources,
		[chatWebSources, viewedFile],
	);
	const previewedWeb = viewedFile?.path.startsWith("web:")
		? (viewedFile.web ??
			webSources.find((source) => source.url === viewedFile.path.slice(4)))
		: undefined;
	// Like a cited page, a memory or action opened from a citation stays listed
	// even if it came from another chat.
	const previewedMemory = viewedFile?.path.startsWith("memory:")
		? memories.data?.find((memory) => viewedFile.path === `memory:${memory.id}`)
		: undefined;
	const previewedAction = viewedFile?.path.startsWith("action:")
		? actions.data?.find((action) => viewedFile.path === `action:${action.id}`)
		: undefined;
	const chatMemories = useMemo(
		() =>
			previewedMemory && !ownMemories.includes(previewedMemory)
				? [...ownMemories, previewedMemory]
				: ownMemories,
		[ownMemories, previewedMemory],
	);
	const chatActions = useMemo(
		() =>
			previewedAction && !ownActions.includes(previewedAction)
				? [...ownActions, previewedAction]
				: ownActions,
		[ownActions, previewedAction],
	);
	const previewedItem = previewedWeb ?? previewedMemory ?? previewedAction;
	const selectionRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (viewedFile && previewedItem && isAsideOpen) {
			selectionRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "nearest",
			});
		}
	}, [previewedItem, viewedFile, isAsideOpen]);
	const treeData = useMemo(() => toTreeData(fileTree), [fileTree]);
	const previewedFile = useMemo(() => {
		if (!viewedFile) return null;
		return (
			files.find(
				(candidate) =>
					candidate.directory === viewedFile.directory &&
					PathUtils.equals(candidate.path, viewedFile.path),
			) ?? null
		);
	}, [files, viewedFile]);
	const viewedNode = useMemo(
		() => (previewedFile ? ChatSourcesUtils.node(previewedFile) : null),
		[previewedFile],
	);

	useEffect(() => {
		if (
			!viewedFile ||
			!viewedNode ||
			processedViewedFile.current === viewedFile
		)
			return;
		processedViewedFile.current = viewedFile;
		const currentTree = treeRef.current;
		currentTree.setExpandedState({
			...currentTree.expandedState,
			...Object.fromEntries(viewedNode.parents.map((parent) => [parent, true])),
		});

		cancelAnimationFrame(highlightFrame.current ?? 0);
		window.clearTimeout(highlightTimeout.current);
		highlightFrame.current = requestAnimationFrame(() => {
			setHighlightedNode(viewedNode.value);
			highlightFrame.current = requestAnimationFrame(() => {
				const node = treeViewport.current?.querySelector<HTMLElement>(
					`[role="treeitem"][data-value="${CSS.escape(viewedNode.value)}"]`,
				);
				node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
				highlightTimeout.current = window.setTimeout(
					() => setHighlightedNode(null),
					100,
				);
			});
		});
	}, [viewedFile, viewedNode]);

	useEffect(() => {
		return () => {
			cancelAnimationFrame(highlightFrame.current ?? 0);
			window.clearTimeout(highlightTimeout.current);
		};
	}, []);

	return (
		<Stack flex={1} h="100%" p={5} gap="xs">
			<Burger
				opened={isAsideOpen}
				onClick={() => setPanel("files", !isAsideOpen)}
				size="sm"
			/>
			<ScrollArea
				// Shrinks to its content, up to 40% of the panel, while a preview is
				// open below it.
				flex={previewedFile || previewedItem ? "0 1 auto" : 1}
				mah={previewedFile || previewedItem ? "40%" : undefined}
				mih={0}
				offsetScrollbars
				viewportRef={treeViewport}
			>
				<Group justify="center">
					{chatFiles.isFetching && <Loader size="xs" />}
				</Group>
				<Text size="sm" fw={600} mb="xs">
					Files
				</Text>
				{treeData.length ? (
					<Tree
						data={treeData}
						tree={tree}
						renderNode={(payload) => (
							<FileTreeNode
								{...payload}
								onLoadDirectory={loadDirectory}
								onPreview={(file) =>
									viewFile({
										path: file.path,
										directory: file.directory,
										chatId,
									})
								}
								highlighted={payload.node.value === highlightedNode}
							/>
						)}
					/>
				) : (
					<Text size="sm" c="dimmed">
						No files
					</Text>
				)}
				<Text size="sm" fw={600} mt="md" mb="xs">
					Web sources
				</Text>
				<Stack gap="xs">
					{webSources.map((source) => (
						<div
							key={source.url}
							ref={previewedWeb?.url === source.url ? selectionRef : undefined}
						>
							<SourceChip
								path={`web:${source.url}`}
								web={source}
								wrap="nowrap"
								py={4}
							>
								<Text size="sm" flex={1} miw={0} truncate>
									{source.title ??
										URL.parse(source.url)?.hostname ??
										source.url}
								</Text>
							</SourceChip>
						</div>
					))}
					{!webSources.length && (
						<Text size="sm" c="dimmed">
							No web sources
						</Text>
					)}
				</Stack>
				<Text size="sm" fw={600} mt="md" mb="xs">
					Memories
				</Text>
				<Stack gap="xs">
					{chatMemories.map((memory) => (
						<Group
							key={memory.id}
							ref={previewedMemory === memory ? selectionRef : undefined}
							gap={4}
							wrap="nowrap"
						>
							<SourceChip
								path={`memory:${memory.id}`}
								wrap="nowrap"
								py={4}
								flex={1}
								miw={0}
							>
								<Text size="sm" flex={1} miw={0} truncate>
									{memory.fact}
								</Text>
							</SourceChip>
							<EditIcon type="memory" id={memory.id} />
						</Group>
					))}
					{!chatMemories.length && (
						<Text size="sm" c="dimmed">
							No memories
						</Text>
					)}
				</Stack>
				<Text size="sm" fw={600} mt="md" mb="xs">
					Actions
				</Text>
				<Stack gap="xs">
					{chatActions.map((action) => (
						<Group
							key={action.id}
							ref={previewedAction === action ? selectionRef : undefined}
							gap={4}
							wrap="nowrap"
						>
							<SourceChip
								path={`action:${action.id}`}
								wrap="nowrap"
								py={4}
								flex={1}
								miw={0}
							>
								<Text size="sm" flex={1} miw={0} truncate>
									{ChatSourcesUtils.action({ action }).prompt}
								</Text>
							</SourceChip>
							<EditIcon type="action" id={action.id} />
						</Group>
					))}
					{!chatActions.length && (
						<Text size="sm" c="dimmed">
							No actions
						</Text>
					)}
				</Stack>
			</ScrollArea>
			{(previewedFile || previewedItem) && <Divider />}
			{previewedWeb && (
				<PreviewPane onClose={() => viewFile(null)}>
					<Web key={previewedWeb.url} source={previewedWeb} h="100%" />
				</PreviewPane>
			)}
			{(previewedMemory || previewedAction) && (
				<PreviewPane
					title={previewedMemory ? "Memory" : "Action"}
					onClose={() => viewFile(null)}
				>
					<ScrollArea h="100%" offsetScrollbars>
						{previewedMemory && <MemoryPreview memory={previewedMemory} />}
						{previewedAction && (
							<ActionPreview
								action={previewedAction}
								lastMessageId={lastMessageId}
							/>
						)}
					</ScrollArea>
				</PreviewPane>
			)}
			{previewedFile && (
				<PreviewPane
					title={PathUtils.name(previewedFile.path)}
					onClose={() => viewFile(null)}
				>
					<Box h="100%" style={{ overflow: "auto" }}>
						<FilePreview file={previewedFile} repos={repos} />
					</Box>
				</PreviewPane>
			)}
		</Stack>
	);
}
