import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useMemo, useState } from "react";
import { ClientContext } from "#client/client.ts";
import { useSubagents } from "#client/features/agent/hooks/useSubagents.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { useChatFiles } from "#client/features/chat/hooks/useChatFiles.ts";
import { GitService } from "#client/features/chat/services/GitService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	ChatFile,
	GitRepo,
} from "#client/features/chat/types/chatFiles.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";

/** How often a repository is asked what changed, while its files are shown. */
const GIT_INTERVAL = 5000;

// Kept outside the hook so the list only changes when a status does.
const combine = (results: { data?: GitRepo }[]) =>
	results.flatMap((result) => (result.data ? [result.data] : []));

/**
 * Everything the chat's sources panel shows: the files the chat (and its
 * subagents) touched as a tree, the web pages they read, and, for files on the machine, the git
 * repositories they are in and what has changed in them.
 *
 * Folders on the machine are read only once they are opened, through
 * `loadDirectory`.
 */
export const useChatSources = () => {
	const client = useContext(ClientContext);
	const shell = client.shell;

	const { chatFiles } = useChatFiles();
	const { messages } = useMessages();
	const { subagents } = useSubagents();
	const { toolsets } = useTools();
	const draftData = useComposerStore((state) => state.data);
	const chatId = useChatStore((state) => state.active.chatId);
	const projectId = useChatStore((state) => state.active.project?.id ?? null);

	// The project folders the chat works in, those that are on this machine.
	const folders = useQuery({
		queryKey: ["useChatSources", "folders", chatId, projectId],
		queryFn: () => client.workingDirectory.folders(),
		enabled: !!shell,
		staleTime: GIT_INTERVAL,
		placeholderData: (previous) => previous,
	});

	const [loaded, setLoaded] = useState<{
		chatId: string | null;
		files: ChatFile[];
	}>({ chatId, files: [] });
	const [loading, setLoading] = useState<Set<string>>(() => new Set());

	// A subagent's run is read like a message, for what it touched.
	const messageList = useMemo(
		() => [...(messages.data?.messages ?? []), ...(subagents.data ?? [])],
		[messages.data, subagents.data],
	);

	const files = useMemo(
		() =>
			ChatSourcesUtils.files({
				mounted: chatFiles.data ?? [],
				folders: folders.data,
				messages: messageList,
				draft: { data: draftData },
				loaded: loaded.chatId === chatId ? loaded.files : [],
				toolsets,
			}),
		[
			chatFiles.data,
			folders.data,
			messageList,
			draftData,
			loaded,
			chatId,
			toolsets,
		],
	);

	const webSources = useMemo(
		() =>
			ChatSourcesUtils.webSources({
				messages: [...messageList, { data: draftData }],
				toolsets,
			}),
		[messageList, draftData, toolsets],
	);

	// Every folder a file on the machine is in, which is where git is asked.
	const directories = useMemo(
		() =>
			[
				...new Set(
					files
						.filter((file) => file.local)
						.map((file) =>
							file.directory
								? file.path
								: file.path.slice(0, file.path.lastIndexOf("/")) || "/",
						),
				),
			].sort(),
		[files],
	);

	const roots = useQuery({
		queryKey: ["useChatSources", "roots", directories],
		queryFn: () =>
			shell ? GitService.roots({ shell, directories }) : Promise.resolve([]),
		enabled: !!shell && directories.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
		placeholderData: (previous) => previous,
	});

	const repos = useQueries({
		queries: (roots.data ?? []).map((root) => ({
			queryKey: ["useChatSources", "status", root],
			queryFn: () =>
				shell
					? GitService.status({ shell, root })
					: Promise.reject(new Error("local files not available")),
			enabled: !!shell,
			refetchInterval: GIT_INTERVAL,
			refetchOnWindowFocus: true,
		})),
		combine,
	});

	const tree = useMemo(
		() => ChatSourcesUtils.tree({ files, repos }),
		[files, repos],
	);

	const loadDirectory = useCallback(
		(directory: ChatFile) => {
			const key = `${chatId}:${directory.path}`;
			if (!shell || !directory.local || loading.has(key)) return;
			setLoading((current) => new Set(current).add(key));
			void shell
				.readDir({ path: directory.path })
				.then((entries) => {
					setLoaded((current) => ({
						chatId,
						files: [
							...(current.chatId === chatId ? current.files : []),
							...entries.map((entry) =>
								ChatSourcesUtils.local(entry.path, entry.is_dir),
							),
						],
					}));
				})
				.catch((error) => {
					console.warn("Failed to read local directory", error);
					setLoading((current) => {
						const next = new Set(current);
						next.delete(key);
						return next;
					});
				});
		},
		[shell, chatId, loading],
	);

	return {
		chatFiles,
		files,
		tree,
		webSources,
		repos,
		loadDirectory,
	};
};
