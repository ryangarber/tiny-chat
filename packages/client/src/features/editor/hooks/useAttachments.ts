import { useCallback, useContext, useMemo, useRef } from "react";
import { ClientContext } from "#client/client.ts";
import { useChatFiles } from "#client/features/chat/hooks/useChatFiles.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type { AttachmentGroup } from "#client/features/editor/types/attachment.ts";
import { AttachmentUtils } from "#client/features/editor/utils/AttachmentUtils.ts";
import { useUploads } from "#client/features/upload/hooks/useUploads.ts";
import { ChatUtils } from "#core/features/data/utils/ChatUtils.ts";
import { FileOperationService } from "#core/features/file/services/FileOperationService.ts";
import { FileSearchService } from "#core/features/file/services/FileSearchService.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/** How long a walked tree answers searches before it is walked again. */
const TREE_TTL = 30_000;

/** Deep enough for any tree laid out by hand; past it is generated. */
const TREE_DEPTH = 16;

/** Entries a picker's walk keeps, after build output and the like are pruned. */
const TREE_ENTRIES = 50_000;

/** Files and folders found below the directory being typed in. */
const MAX_DEEP_RESULTS = 20;

interface LocalTree {
	at: number;
	tree: Promise<{
		root: string;
		entries: { path: string; is_dir: boolean }[];
	}>;
}

/**
 * Build the attachments available to any client: everything on the mount, the
 * uploads and repositories the account holds, recent chats, plus files on the
 * local machine when the client can read the filesystem.
 */
export const useAttachments = () => {
	const client = useContext(ClientContext);

	const { filesystem } = useChatFiles();
	const filesystemRef = useRef(filesystem);
	filesystemRef.current = filesystem;

	const { attachmentUploads, githubUploads } = useUploads();

	// An upload the chat does not point into yet is not on the mount, so it is
	// offered from the account's own uploads. Choosing one names its directory,
	// which is both the attachment and the way into its files.
	const uploadGroups = useMemo((): AttachmentGroup[] => {
		const toGroup = (
			name: string,
			uploads: { id: string; name: string }[] | undefined,
		) =>
			uploads?.length
				? [
						{
							name,
							items: uploads.map((upload) =>
								AttachmentUtils.forUpload({ upload }),
							),
						},
					]
				: [];

		return [
			...toGroup(
				"Uploads",
				attachmentUploads.data?.pages
					.flatMap((page) => page.uploads)
					.slice(0, 5),
			),
			...toGroup("GitHub", githubUploads.data?.slice(0, 5)),
		];
	}, [attachmentUploads.data, githubUploads.data]);

	const uploadGroupsRef = useRef(uploadGroups);
	uploadGroupsRef.current = uploadGroups;

	// The chats on the sidebar's first page, newest first, to ask about from
	// this one. The chat being written in is already all there.
	const { projects: chatList } = useChatList();
	const chatId = useChatStore((state) => state.active.chatId);
	const chatGroups = useMemo((): AttachmentGroup[] => {
		const page = chatList.data?.pages[0];
		const chats = [
			...(page?.chats ?? []),
			...(page?.projects.flatMap((project) => project.chats) ?? []),
		]
			.filter((chat) => chat.id !== chatId)
			.sort((a, b) => ChatUtils.getTimestamp(b) - ChatUtils.getTimestamp(a))
			.slice(0, 5);

		return chats.length
			? [
					{
						name: "Chats",
						items: chats.map((chat) => AttachmentUtils.forChat({ chat })),
					},
				]
			: [];
	}, [chatList.data, chatId]);

	const chatGroupsRef = useRef(chatGroups);
	chatGroupsRef.current = chatGroups;

	// Walking a large tree is the slow part of a search and its answer barely
	// changes between keystrokes, so each directory is walked once and kept for
	// a little while. Keyed by the working directory too: `.` moves with it.
	const treesRef = useRef(new Map<string, LocalTree>());
	const getTree = useCallback(
		(path: string): LocalTree["tree"] => {
			const shell = client.shell;
			if (!shell) return Promise.resolve({ root: path, entries: [] });

			const tree = (async () => {
				const key = `${(await shell.cwd?.()) ?? ""}\0${path}`;
				const cached = treesRef.current.get(key);
				if (cached && Date.now() - cached.at < TREE_TTL) return cached.tree;

				const walked = FileSearchService.walk({
					shell,
					path,
					scope: "lookup",
					includeDirectories: true,
					maxDepth: TREE_DEPTH,
					maxEntries: TREE_ENTRIES,
				});
				treesRef.current.set(key, { at: Date.now(), tree: walked });
				walked.catch(() => treesRef.current.delete(key));
				return walked;
			})();
			// Started ahead of being needed, so a failure here is only reported
			// by whoever awaits it.
			tree.catch(() => {});
			return tree;
		},
		[client],
	);

	const getAttachables = useCallback(
		async (query: string, signal?: AbortSignal): Promise<AttachmentGroup[]> => {
			const parts = query.replace(/^\//, "").split("/");
			const directory = parts.slice(0, -1);

			// Walking into an upload the chat does not point into yet is exactly
			// the case a mount built from ids can answer: ask for that one too.
			const getMounted = async (): Promise<AttachmentGroup[]> => {
				const [tree, id] = directory;
				const mounted = FileUtils.mount({
					filesystem: filesystemRef.current,
					mount: PathUtils.mounts.find((name) => name === tree),
					id,
				});

				try {
					const entries = await client.api.file.getDirectory.query({
						...mounted,
						path: directory,
					});
					return [
						{
							name: "Files",
							items: entries.map((entry) => ({
								name: entry.label ?? entry.name,
								label: entry.label ?? undefined,
								value: entry.uri,
								path: entry.path.join("/"),
								directory: entry.isDirectory,
								traversable: true,
							})),
						},
					];
				} catch (error) {
					console.warn("[useAttachments] failed to read mount files", error);
					return [];
				}
			};

			const getLocal = async (): Promise<AttachmentGroup[]> => {
				if (!client.shell) return [];

				const local =
					`${query.startsWith("/") ? "/" : ""}${directory.join("/")}` || ".";
				const name = PathUtils.name(query);

				// Walked the first time a directory is looked at — the menu opening
				// is the bare `@` — and searched on every keystroke after that.
				const localTree = getTree(local);

				try {
					const listing = await client.shell.readDir({ path: local });

					// Whatever sits directly in the directory comes first, unfiltered:
					// it is what the user is looking at. Matches further down follow
					// in a group of their own, so a name does not have to be walked to
					// one segment at a time.
					const direct: AttachmentGroup = {
						name: "Local",
						items: listing.map((file) => ({
							name: PathUtils.name(file),
							value: PathUtils.normalize(file),
							directory: file.is_dir,
							traversable: true,
						})),
					};
					if (!name.trim() || signal?.aborted) return [direct];

					// The listing and the walk may spell the same directory differently
					// (`.` against where it resolved to), so a direct child is told by
					// its place in the tree, not by its path matching the listing's.
					const seen = new Set(
						direct.items.map((item) =>
							PathUtils.normalize({ path: item.value, unix: true }),
						),
					);
					const { root, entries } = await localTree;
					const deep = FileOperationService.matchNames({
						entries: entries
							.map((entry) => ({
								...entry,
								relative: PathUtils.relative({ base: root, path: entry.path }),
							}))
							.filter(
								(entry) =>
									entry.relative.includes("/") &&
									!seen.has(
										PathUtils.normalize({ path: entry.path, unix: true }),
									),
							),
						root,
						query: name,
						maxResults: MAX_DEEP_RESULTS,
					});

					// A match further down is continued by its whole path from what
					// has been typed so far, not by its name in place of the last
					// segment.
					const prefix = query.slice(0, query.lastIndexOf("/") + 1);

					return [
						direct,
						{
							name: "Search",
							// Matched on whole paths, which filtering by name would undo.
							matched: true,
							items: deep.map((file) => ({
								name: PathUtils.name(file),
								value: PathUtils.normalize(file),
								path: `${prefix}${file.relative}`,
								directory: file.is_dir,
								traversable: true,
							})),
						},
					];
				} catch (error) {
					console.warn("[useAttachments] failed to read local files", error);
					return [];
				}
			};

			const [mounted, local] = await Promise.all([getMounted(), getLocal()]);
			if (signal?.aborted) return [];

			return [
				...mounted,
				// Uploads stand outside the mount until something points into them,
				// so they are only offered while the query is still a bare name
				// rather than a path being walked down.
				...(directory.length ? [] : uploadGroupsRef.current),
				...(directory.length ? [] : chatGroupsRef.current),
				...local,
			];
		},
		[client, getTree],
	);

	return { getAttachables };
};
