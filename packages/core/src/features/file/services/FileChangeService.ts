import type { ShellCapability } from "#core/core/types/capability.ts";
import type { zFileChanges } from "#core/features/data/types/part.ts";
import { FileSearchService } from "#core/features/file/services/FileSearchService.ts";
import {
	type FileChangeState,
	FileChangeUtils,
} from "#core/features/file/utils/FileChangeUtils.ts";
import { FileExcludeUtils } from "#core/features/file/utils/FileExcludeUtils.ts";

/** What change tracking needs of a shell: to run `git` and read files. */
export type FileChangeShell = Pick<ShellCapability, "exec" | "readFile"> &
	Partial<Pick<ShellCapability, "run" | "readFiles" | "toShellPath">>;

/** Every repository being watched, as it stood at one moment. */
type Snapshot = Map<string, RepoSnapshot | null>;

interface RepoSnapshot {
	head: string | null;
	/** Each dirty path, relative to the root, and what it held. */
	dirty: Map<string, FileChangeState>;
}

/** A path as one bash word, for a shell that can only take a command line. */
const quote = (word: string) => `"${word.replace(/(["$`\\])/g, "\\$1")}"`;

/** Repositories watched at once, one per folder at most. */
const MAX_REPOS = 8;

/** `git show`s at once, and in all, to learn what clean files held. */
const SHOW_CONCURRENCY = 8;
const MAX_SHOWS = 200;

const git = async (
	shell: FileChangeShell,
	args: string[],
): Promise<string | null> => {
	try {
		const result = shell.run
			? await shell.run({ program: "git", args })
			: await shell.exec({ command: ["git", ...args].map(quote).join(" ") });
		return result.code === 0 ? result.stdout : null;
	} catch {
		return null;
	}
};

const join = (root: string, path: string) =>
	`${root.replace(/\/+$/, "")}/${path}`;

/**
 * Finds what a call changed in the user's repositories when the tool that made
 * the change does not say: a shell command, an MCP server's tool, an agent's
 * own edits. Git says which files are dirty, which keeps a snapshot down to
 * those; a clean file's earlier contents are the checked-out commit's.
 *
 * Folders that are not repositories, or where git is not installed, are left
 * alone: without git there is no cheap record of what a file held before.
 */
export const FileChangeService = {
	/** The repositories `folders` are in, one each, as the shell spells them. */
	getRoots: async ({
		shell,
		folders,
	}: {
		shell: FileChangeShell;
		folders: string[];
	}): Promise<string[]> => {
		const roots = await Promise.all(
			folders.slice(0, MAX_REPOS).map(async (folder) => {
				const path = shell.toShellPath?.({ path: folder }) ?? folder;
				const output = await git(shell, [
					"-C",
					path,
					"rev-parse",
					"--show-toplevel",
				]);
				return output?.trim().split(/\r?\n/)[0] || null;
			}),
		);
		return [...new Set(roots.filter((root) => root !== null))];
	},

	/** One repository's dirty files and what they held. Null if it can't be told. */
	snapshot: async ({
		shell,
		root,
	}: {
		shell: FileChangeShell;
		root: string;
	}): Promise<RepoSnapshot | null> => {
		const output = await git(shell, [
			"-C",
			root,
			...FileChangeUtils.statusArgs,
		]);
		if (output === null) return null;
		const status = FileChangeUtils.parseStatus(output);
		const { limits } = FileChangeUtils;
		if (status.truncated || status.paths.length > limits.dirty) return null;

		const read = await FileSearchService.readFiles({
			shell,
			paths: status.paths.map((path) => join(root, path)),
			maxBytes: limits.readBytes + 1,
		});

		let bytes = 0;
		const dirty = new Map<string, FileChangeState>();
		status.paths.forEach((path, index) => {
			const file = read[index];
			const state = FileChangeUtils.getState({
				path,
				data: file?.data,
				size: file?.size,
			});
			if (state.type === "text") {
				bytes += state.text.length;
				// Past the budget, only its size is kept to compare by.
				if (bytes > limits.snapshotBytes) {
					dirty.set(path, {
						type: "skipped",
						reason: "limit",
						size: file?.size ?? 0,
					});
					return;
				}
			}
			dirty.set(path, state);
		});
		return { head: status.head, dirty };
	},

	/** A file as a commit has it; missing if the commit does not. */
	getCommitted: async ({
		shell,
		root,
		head,
		path,
	}: {
		shell: FileChangeShell;
		root: string;
		head: string | null;
		path: string;
	}): Promise<FileChangeState> => {
		if (!head) return { type: "missing" };
		const object = `${head}:${path}`;
		// A lockfile's size is all there is to compare it by.
		const excluded = FileExcludeUtils.getExcluded({ path });
		if (excluded) {
			const size = await git(shell, ["-C", root, "cat-file", "-s", object]);
			return size === null
				? { type: "missing" }
				: { type: "skipped", reason: excluded, size: Number(size.trim()) };
		}
		const text = await git(shell, ["-C", root, "show", object]);
		return FileChangeUtils.getTextState({ path, text });
	},

	/** What changed in one repository between two of its snapshots. */
	compare: async ({
		shell,
		root,
		before,
		after,
	}: {
		shell: FileChangeShell;
		root: string;
		before: RepoSnapshot;
		after: RepoSnapshot;
	}) => {
		const paths = [...new Set([...before.dirty.keys(), ...after.dirty.keys()])];
		// Dirty in only one of them: the other side is what a commit has, and
		// past the cap those are left out rather than asked about one by one.
		const shown = paths.filter(
			(path) => !before.dirty.has(path) || !after.dirty.has(path),
		);
		const skipped = new Set(shown.slice(MAX_SHOWS));
		const state = (snapshot: RepoSnapshot, path: string) =>
			snapshot.dirty.get(path) ??
			FileChangeService.getCommitted({
				shell,
				root,
				head: snapshot.head,
				path,
			});

		const files: {
			path: string;
			before: FileChangeState;
			after: FileChangeState;
		}[] = [];
		const pending = paths.filter((path) => !skipped.has(path));
		const work = async () => {
			for (let path = pending.shift(); path; path = pending.shift()) {
				const [earlier, later] = await Promise.all([
					state(before, path),
					state(after, path),
				]);
				files.push({ path: join(root, path), before: earlier, after: later });
			}
		};
		await Promise.all(Array.from({ length: SHOW_CONCURRENCY }, work));
		return files;
	},

	/**
	 * Watches `folders` across calls. Each call is bracketed by `begin` and
	 * `end`, and `end` reports what changed since the last moment nothing was
	 * running, or the last `end`. Calls that overlap share a window, and each
	 * change is reported once, by the first to finish after it. Never throws.
	 */
	createTracker: ({
		shell,
		folders,
	}: {
		shell: FileChangeShell;
		folders: () => Promise<string[]>;
	}) => {
		let roots: Promise<string[]> | undefined;
		let running = 0;
		let baseline: Promise<Snapshot> | undefined;
		let queue: Promise<unknown> = Promise.resolve();

		const take = async (): Promise<Snapshot> => {
			roots ??= folders()
				.then((folders) => FileChangeService.getRoots({ shell, folders }))
				.catch(() => []);
			const found = await roots;
			const snapshots = await Promise.all(
				found.map((root) =>
					FileChangeService.snapshot({ shell, root }).catch(() => null),
				),
			);
			return new Map(found.map((root, index) => [root, snapshots[index]]));
		};

		return {
			begin: async (): Promise<void> => {
				if (running++ === 0) baseline = take();
				await baseline;
			},

			/** Ends a call that never ran, such as one the user rejected. */
			cancel: (): void => {
				running = Math.max(0, running - 1);
			},

			end: (): Promise<zFileChanges | undefined> => {
				const next = queue.then(async () => {
					try {
						const before = await baseline;
						const after = await take();
						baseline = Promise.resolve(after);
						if (!before) return undefined;
						const files = await Promise.all(
							[...after].map(async ([root, snapshot]) => {
								const earlier = before.get(root);
								if (!snapshot || !earlier) return [];
								return await FileChangeService.compare({
									shell,
									root,
									before: earlier,
									after: snapshot,
								});
							}),
						);
						return FileChangeUtils.getChanges(files.flat()) ?? undefined;
					} catch (error) {
						console.warn("[FileChangeService] could not compare:", error);
						return undefined;
					} finally {
						running = Math.max(0, running - 1);
					}
				});
				queue = next;
				return next;
			},
		};
	},
} as const;

export type FileChangeTracker = ReturnType<
	typeof FileChangeService.createTracker
>;
