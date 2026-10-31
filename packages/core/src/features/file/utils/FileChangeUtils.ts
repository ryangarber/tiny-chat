import type {
	zFileChange,
	zFileChanges,
} from "#core/features/data/types/part.ts";
import { FileExcludeUtils } from "#core/features/file/utils/FileExcludeUtils.ts";

/**
 * A file as it stood at one moment: its text, why it has none worth showing
 * (with its size, to tell whether it changed), or absent.
 */
export type FileChangeState =
	| { type: "text"; text: string }
	| { type: "skipped"; reason: string; size: number }
	| { type: "missing" };

/** One repository's working tree, as far as `git status` tells it apart. */
export interface FileChangeStatus {
	/** The commit checked out; null before the first. */
	head: string | null;
	/** Every path `git status` lists, relative to the repository's root. */
	paths: string[];
	/** The output was cut short, so a path left out may still be dirty. */
	truncated: boolean;
}

/** Lines of unchanged context kept either side of a change. */
const CONTEXT_LINES = 3;

/** How a call's changes are bounded, so one `git checkout` cannot flood a chat. */
const LIMITS = {
	/** Files listed, with or without their contents. */
	files: 50,
	/** Files whose contents are kept. */
	diffs: 20,
	/** Characters of one file's trimmed before and after together. */
	fileChars: 40_000,
	/** Characters of every file's together. */
	totalChars: 200_000,
	/** Files read whole, whose contents can be compared at all. */
	readBytes: FileExcludeUtils.maxFileBytes,
	/** Dirty files a snapshot holds before the rest are compared by size alone. */
	snapshotBytes: 32 * 1024 * 1024,
	/** Dirty files above which a repository is not watched for that call. */
	dirty: 2_000,
} as const;

const splitLines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

export const FileChangeUtils = {
	limits: LIMITS,

	/** `git` arguments whose output {@link FileChangeUtils.parseStatus} reads. */
	statusArgs: [
		"status",
		"--porcelain=v2",
		"--branch",
		"-z",
		"--untracked-files=all",
		"--no-renames",
		"--ignore-submodules=all",
	],

	/**
	 * Porcelain v2 with `-z`: `# branch.oid <sha>` and then one entry per path,
	 * NUL-terminated. Paths are always relative to the repository's root.
	 */
	parseStatus: (output: string): FileChangeStatus => {
		let head: string | null = null;
		const paths: string[] = [];
		// What `ToolOutputUtils.collect` leaves where it cut the middle out.
		const truncated = /\n\[… \d+ characters omitted …\]\n/.test(output);
		const entries = output.split("\0");
		for (let index = 0; index < entries.length; index++) {
			const entry = entries[index];
			if (entry.startsWith("# branch.oid ")) {
				const oid = entry.slice("# branch.oid ".length).trim();
				head = /^[0-9a-f]{7,}$/.test(oid) ? oid : null;
				continue;
			}
			// Fields before the path: changed 8, renamed 9 (+ its origin), unmerged 10.
			const fields = { "1": 8, "2": 9, u: 10, "?": 1 }[entry[0]];
			if (fields === undefined || entry[1] !== " ") continue;
			const parts = entry.split(" ");
			const path = parts.slice(fields).join(" ");
			if (path) paths.push(path);
			if (entry[0] === "2") index++;
		}
		return { head, paths, truncated };
	},

	/**
	 * A file's state from what was read of it: text, or why it is not worth
	 * showing. Lockfiles, generated, minified, binary and secret files keep only
	 * their size; `size` is the whole file's, which may be more than was read.
	 */
	getState: ({
		path,
		data,
		size = data?.length ?? 0,
	}: {
		path: string;
		data: Uint8Array | null | undefined;
		size?: number;
	}): FileChangeState => {
		if (!data) return { type: "missing" };
		const excluded = FileExcludeUtils.getExcluded({ path });
		if (excluded) return { type: "skipped", reason: excluded, size };
		if (size > LIMITS.readBytes)
			return { type: "skipped", reason: "large", size };
		const skip = FileExcludeUtils.getSkipReason({
			path,
			data,
			maxBytes: LIMITS.readBytes,
		});
		if (skip.reason !== null)
			return { type: "skipped", reason: skip.reason, size };
		return { type: "text", text: skip.text };
	},

	/** A state from text a command printed, such as `git show`. */
	getTextState: ({
		path,
		text,
	}: {
		path: string;
		text: string | null;
	}): FileChangeState =>
		text === null
			? { type: "missing" }
			: FileChangeUtils.getState({
					path,
					data: new TextEncoder().encode(text),
				}),

	/**
	 * Whether two states differ. Files without text are compared by size, which
	 * catches a lockfile rewritten by an install but not one rewritten in place.
	 */
	isChanged: (before: FileChangeState, after: FileChangeState): boolean => {
		if (before.type !== after.type) return true;
		if (before.type === "text" && after.type === "text")
			return before.text !== after.text;
		if (before.type === "skipped" && after.type === "skipped")
			return before.size !== after.size || before.reason !== after.reason;
		return false;
	},

	/**
	 * The lines that changed between two texts, with {@link CONTEXT_LINES} of
	 * context either side; everything above and below is the same in both.
	 */
	trim: ({
		before,
		after,
		context = CONTEXT_LINES,
	}: {
		before: string;
		after: string;
		context?: number;
	}): { before: string; after: string } => {
		const a = splitLines(before);
		const b = splitLines(after);
		let prefix = 0;
		while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
			prefix++;
		let suffix = 0;
		while (
			suffix < a.length - prefix &&
			suffix < b.length - prefix &&
			a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
		)
			suffix++;
		const start = Math.max(0, prefix - context);
		const end = Math.max(0, suffix - context);
		return {
			before: a.slice(start, a.length - end).join(""),
			after: b.slice(start, b.length - end).join(""),
		};
	},

	/**
	 * What a call changed, from each changed file's state before and after it,
	 * held to {@link LIMITS}. Null when nothing changed.
	 */
	getChanges: (
		files: { path: string; before: FileChangeState; after: FileChangeState }[],
	): zFileChanges | null => {
		const changed = files
			.filter(({ before, after }) => FileChangeUtils.isChanged(before, after))
			.sort((a, b) => a.path.localeCompare(b.path));
		if (!changed.length) return null;

		let diffs = 0;
		let chars = 0;
		const listed = changed
			.slice(0, LIMITS.files)
			.map(({ path, before, after }): zFileChange => {
				const skipped =
					before.type === "skipped"
						? before.reason
						: after.type === "skipped"
							? after.reason
							: undefined;
				if (skipped) return { path, skipped };
				if (diffs >= LIMITS.diffs) return { path, skipped: "limit" };

				const trimmed = FileChangeUtils.trim({
					before: before.type === "text" ? before.text : "",
					after: after.type === "text" ? after.text : "",
				});
				const size = trimmed.before.length + trimmed.after.length;
				if (size > LIMITS.fileChars) return { path, skipped: "large" };
				if (chars + size > LIMITS.totalChars) return { path, skipped: "limit" };

				diffs++;
				chars += size;
				return {
					path,
					...(before.type === "text" ? { before: trimmed.before } : {}),
					...(after.type === "text" ? { after: trimmed.after } : {}),
				};
			});

		return {
			files: listed,
			...(changed.length > listed.length
				? { omitted: changed.length - listed.length }
				: {}),
		};
	},
} as const;
