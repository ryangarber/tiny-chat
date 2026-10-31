import type {
	ChatFile,
	ChatFileChanges,
	ChatFileNode,
	GitRepo,
} from "#client/features/chat/types/chatFiles.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import type { MemoryState } from "#core/features/data/types/memory.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { SourceUtils } from "#core/features/data/utils/SourceUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";

type MessageLike = Pick<MessageState, "data">;

/** A file on the chat's mount, as `file.getFiles` lists it. */
interface MountedFile {
	path: string[];
	uri: string;
	isDirectory: boolean;
}

/** The first `count` parts of an absolute path, keeping its leading slash. */
const prefix = (path: string, count: number) =>
	(path.startsWith("/") ? "/" : "") +
	PathUtils.split(path).slice(0, count).join("/");

export const ChatSourcesUtils = {
	local: (path: string, directory: boolean): ChatFile => {
		const normalized = PathUtils.normalize({ path, unix: true });
		return {
			path: normalized,
			directory,
			local: true,
			displayPath: ["local", ...PathUtils.split(normalized)],
		};
	},

	/** Files on the machine that were attached to a message. */
	attachments: (message: MessageLike): ChatFile[] =>
		message.data
			.flat()
			.flatMap((part) =>
				part.type === "attachment" &&
				(part.content.type === "file" ||
					part.content.type === "directory" ||
					part.content.type === "unavailable") &&
				!PathUtils.isMounted(part.source)
					? [
							ChatSourcesUtils.local(
								part.source,
								part.content.type === "directory",
							),
						]
					: [],
			),

	/**
	 * Files on the machine that a message's calls changed without saying so — a
	 * shell command, an MCP server's tool, Claude Code's own. One that is gone
	 * now has nothing left to open.
	 */
	changed: (message: MessageLike): ChatFile[] =>
		message.data
			.flat()
			.flatMap((part) =>
				part.type === "toolResult" && part.changes ? part.changes.files : [],
			)
			.flatMap((change) =>
				(change.after !== undefined || change.skipped) &&
				!PathUtils.isMounted(change.path)
					? [ChatSourcesUtils.local(change.path, false)]
					: [],
			),

	/**
	 * Every file the chat has touched: what is on its mount, the project folders
	 * it works in, what its messages (and the one being written) attached,
	 * pointed tools at or changed, and whatever was read out of those folders
	 * since. Folders that are no longer referenced take what was read out of
	 * them with them.
	 */
	files: ({
		mounted,
		folders = [],
		messages,
		draft,
		loaded,
		toolsets,
	}: {
		mounted: MountedFile[];
		/** The chat's folders on this machine, as the working directory found them. */
		folders?: string[];
		messages: MessageLike[];
		draft: MessageLike;
		loaded: ChatFile[];
		toolsets: Toolset<any>[];
	}): ChatFile[] => {
		const mount = mounted.map((node): ChatFile => {
			const [tree, id, ...rest] = node.path;
			return {
				path: node.uri,
				directory: node.isDirectory,
				local: false,
				displayPath:
					tree === "chat"
						? [tree, ...rest]
						: [tree, id, ...rest].filter(Boolean),
			};
		});
		const project = folders.map((path) => ChatSourcesUtils.local(path, true));
		const referenced = messages.flatMap((message) => [
			...SourceUtils.find({ message, toolsets }).flatMap((source) =>
				source.type === "file" && !PathUtils.isMounted(source.value)
					? [ChatSourcesUtils.local(source.value.path, source.value.directory)]
					: [],
			),
			...ChatSourcesUtils.attachments(message),
			...ChatSourcesUtils.changed(message),
		]);
		const drafted = ChatSourcesUtils.attachments(draft);
		const directories = [...project, ...referenced, ...drafted].filter(
			(file) => file.directory,
		);
		const read = loaded.filter((entry) =>
			directories.some(
				(directory) =>
					PathUtils.equals(directory.path, entry.path) ||
					PathUtils.contains({
						parent: directory.path,
						descendent: entry.path,
					}),
			),
		);
		return [
			...new Map(
				[...mount, ...project, ...referenced, ...drafted, ...read].map(
					(file) => [`${file.local}:${file.path}`, file],
				),
			).values(),
		];
	},

	/** Web pages the chat has read, each once, with the most of it any read got. */
	webSources: ({
		messages,
		toolsets,
	}: {
		messages: MessageLike[];
		toolsets: Toolset<any>[];
	}): zWebContext[] => {
		const byUrl = new Map<string, zWebContext>();
		for (const message of messages) {
			for (const source of SourceUtils.find({ message, toolsets })) {
				if (source.type !== "web") continue;
				const existing = byUrl.get(source.value.url);
				if (!existing || source.value.content.length > existing.content.length)
					byUrl.set(source.value.url, source.value);
			}
		}
		return [...byUrl.values()];
	},

	/** What the panel shows of a memory, and the message it came from. */
	memory: (memory: MemoryState) => ({
		fact: memory.fact,
		evidence: memory.evidence,
		details: [
			memory.category.toLowerCase(),
			memory.stability.toLowerCase().replace("_", " "),
			`${Math.round(memory.confidence * 100)}% confident`,
		].join(" · "),
		learned: `learned ${CommonUtils.formatDate({ date: memory.createdAt, relative: true })}`,
		messageId: memory.messageId,
	}),

	/**
	 * What the panel shows of an action. The message it was scheduled from is
	 * only worth going to when it isn't the one the chat already ends on.
	 */
	action: ({
		action,
		lastMessageId,
	}: {
		action: ActionState;
		lastMessageId?: string;
	}) => ({
		prompt: DataUtils.getTextCleaned({ data: action.data }),
		schedule: CommonUtils.describeSchedule(action.schedule),
		lastRun: action.lastRanAt
			? `Last ran ${CommonUtils.formatDate({ date: action.lastRanAt, relative: true })}`
			: "Hasn't run yet",
		nextRun: action.nextRunAt
			? `Next run ${CommonUtils.formatDate({ date: action.nextRunAt, relative: true })}`
			: null,
		messageId: action.messageId === lastMessageId ? null : action.messageId,
	}),

	/** The tree node a file sits at, and the folders above it. */
	node: (file: ChatFile) => {
		const root = file.local ? "local" : "mount";
		const at = (length: number) =>
			`${root}:${file.displayPath.slice(0, length).join("/")}`;
		return {
			value: at(file.displayPath.length),
			parents: file.displayPath.slice(0, -1).map((_, index) => at(index + 1)),
		};
	},

	/** What changed at or below a path, across the repositories it is in. */
	changes: ({
		path,
		repos,
	}: {
		path: string;
		repos: GitRepo[];
	}): ChatFileChanges | undefined => {
		const base = PathUtils.normalize({ path, unix: true }).replace(/\/+$/, "");
		let found = false;
		const total = { additions: 0, deletions: 0 };
		for (const repo of repos) {
			for (const change of repo.changes) {
				if (change.path !== base && !change.path.startsWith(`${base}/`))
					continue;
				found = true;
				total.additions += change.additions;
				total.deletions += change.deletions;
			}
		}
		return found ? total : undefined;
	},

	/**
	 * The files as a tree, with the folders between them filled in. Anything on
	 * the machine carries the changes git has under it, so a folder adds up
	 * every change below it, whether or not it has been opened yet.
	 */
	tree: ({
		files,
		repos = [],
	}: {
		files: ChatFile[];
		repos?: GitRepo[];
	}): ChatFileNode[] => {
		const roots: ChatFileNode[] = [];
		const nodes = new Map<string, ChatFileNode>();
		for (const file of files) {
			let children = roots;
			for (let index = 0; index < file.displayPath.length; index++) {
				const parts = file.displayPath.slice(0, index + 1);
				const value = `${file.local ? "local" : "mount"}:${parts.join("/")}`;
				const last = index === file.displayPath.length - 1;
				let node = nodes.get(value);
				if (!node) {
					node = {
						value,
						label: parts.at(-1) ?? "",
						directory: true,
						local: file.local,
						children: [],
					};
					// Below `local` every folder is a real one on the machine.
					if (file.local && index > 0 && repos.length)
						node.changes = ChatSourcesUtils.changes({
							path: last ? file.path : prefix(file.path, index),
							repos,
						});
					nodes.set(value, node);
					children.push(node);
				}
				if (last) {
					node.file = file;
					node.directory = file.directory;
				}
				children = node.children;
			}
		}
		// Folders first, then by name, the way a file browser lists them. The
		// roots keep the order the files came in, which puts the mount first.
		const sort = (nodes: ChatFileNode[]) => {
			nodes.sort(
				(a, b) =>
					Number(b.directory) - Number(a.directory) ||
					a.label.localeCompare(b.label),
			);
			for (const node of nodes) sort(node.children);
		};
		for (const root of roots) sort(root.children);
		return roots;
	},

	/** A tree's nodes in the order they are drawn, skipping collapsed folders. */
	flatten: ({
		nodes,
		expanded,
		depth = 0,
	}: {
		nodes: ChatFileNode[];
		expanded: (node: ChatFileNode) => boolean;
		depth?: number;
	}): { node: ChatFileNode; depth: number }[] =>
		nodes.flatMap((node) => [
			{ node, depth },
			...(node.directory && expanded(node)
				? ChatSourcesUtils.flatten({
						nodes: node.children,
						expanded,
						depth: depth + 1,
					})
				: []),
		]),
} as const;
