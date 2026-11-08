import fuzzysort from "fuzzysort";
import type { ShellCapability } from "#core/core/types/capability.ts";
import { FileSearchService } from "#core/features/file/services/FileSearchService.ts";
import {
	type FileEditResult,
	FileEditUtils,
} from "#core/features/file/utils/FileEditUtils.ts";
import type { FileScope } from "#core/features/file/utils/FileExcludeUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/** Lines a single `readText` call returns when the caller does not say. */
const DEFAULT_LINE_LIMIT = 1_000;

/** Characters a single `readText` call returns, whatever the line limit says. */
const MAX_READ_CHARS = 120_000;

/** Characters of any one line that are returned before it is cut. */
const MAX_LINE_CHARS = 2_000;

/** Lines of context shown around an applied edit. */
const EDIT_CONTEXT_LINES = 3;

export interface FileReadResult {
	path: string;
	text: string;
	/** 1-based line the excerpt starts at. */
	offset: number;
	/** Lines returned. */
	lines: number;
	/** Lines in the whole file. */
	total: number;
	truncated: boolean;
	/** Present when the file was cut short, explaining how to read the rest. */
	notice?: string;
}

export const FileOperationService = {
	walk: async ({
		shell,
		path,
		scope = "listing",
		includeDirectories = false,
	}: {
		shell: Pick<ShellCapability, "readDir"> &
			Partial<Pick<ShellCapability, "readFile" | "readFiles" | "walk">>;
		path: string;
		scope?: FileScope;
		includeDirectories?: boolean;
	}) => {
		const { entries } = await FileSearchService.walk({
			shell,
			path,
			scope,
			includeDirectories,
		});
		return entries;
	},

	/**
	 * {@link ShellCapability.readFiles}, built from `readFile` for shells that
	 * cannot read in bulk natively.
	 */
	readFiles: FileSearchService.readFiles,

	/**
	 * Reads a window of a text file. Unbounded reads are the easiest way for an
	 * agent to lose its context to a single file, so every read is capped by
	 * lines, by characters and by line length, and says so when it cuts.
	 */
	readText: async ({
		shell,
		path,
		offset,
		limit,
	}: {
		shell: Pick<ShellCapability, "readFile">;
		path: string;
		offset?: number;
		limit?: number;
	}): Promise<FileReadResult> => {
		const file = await shell.readFile({ path });
		const content = FileUtils.getTextFromBytes(file);
		if (content === null)
			throw new Error(`Cannot read file as text: ${file.path}`);

		return FileOperationService.getTextWindow({
			path: file.path,
			content,
			offset,
			limit,
		});
	},

	/**
	 * The windowing half of {@link readText}, over content already in hand.
	 */
	getTextWindow: ({
		path,
		content,
		offset = 1,
		limit = DEFAULT_LINE_LIMIT,
	}: {
		path: string;
		content: string;
		offset?: number;
		limit?: number;
	}): FileReadResult => {
		const all = content.split("\n");
		const start = Math.max(1, Math.floor(offset));
		const end = Math.min(
			all.length,
			start + Math.max(1, Math.floor(limit)) - 1,
		);

		if (start > all.length && all.length > 0) {
			throw new Error(
				`Offset ${start} is past the end of ${path}, which has ${all.length} line(s).`,
			);
		}

		const selected: string[] = [];
		let characters = 0;
		let cut = false;

		for (let index = start; index <= end; index++) {
			const line = all[index - 1] ?? "";
			const trimmed =
				line.length > MAX_LINE_CHARS
					? `${line.slice(0, MAX_LINE_CHARS)}… [${line.length - MAX_LINE_CHARS} more characters on this line]`
					: line;
			if (characters + trimmed.length > MAX_READ_CHARS) {
				cut = true;
				break;
			}
			selected.push(trimmed);
			characters += trimmed.length + 1;
		}

		const last = start + selected.length - 1;
		const truncated = cut || last < all.length || start > 1;

		return {
			path,
			text: selected.join("\n"),
			offset: start,
			lines: selected.length,
			total: all.length,
			truncated,
			notice: truncated
				? `Showing lines ${start}-${last} of ${all.length}. Read further with offset ${last + 1}, or use search_files in regex mode to jump to what you need.`
				: undefined,
		};
	},

	/**
	 * Fuzzy file-name lookup, for pickers and for locating a file whose exact
	 * spelling is unknown. Never reads file contents.
	 *
	 * Matches on names alone, so it withholds only what nobody would attach:
	 * someone reaching for `logo.png` has to be able to find `logo.png`, but
	 * nobody reaching for `main.rs` means the copy under `target/debug`.
	 */
	searchNames: async ({
		shell,
		path,
		query,
		scope = "lookup",
		maxResults = 10,
	}: {
		shell: Pick<ShellCapability, "readDir"> &
			Partial<Pick<ShellCapability, "readFile" | "readFiles" | "walk">>;
		path: string;
		query: string;
		scope?: FileScope;
		maxResults?: number;
	}): Promise<{ path: string; is_dir: boolean }[]> => {
		if (!query.trim()) throw new Error("Search query must not be empty.");

		const { root, entries } = await FileSearchService.walk({
			shell,
			path,
			scope,
			includeDirectories: true,
		});

		return FileOperationService.matchNames({
			entries,
			root,
			query,
			maxResults,
		});
	},

	/**
	 * The matching half of {@link searchNames}, over entries already walked, so
	 * a picker can walk a tree once and match against it on every keystroke.
	 *
	 * Paths are matched as seen from `root`, the way they are typed: the
	 * directories above it are the same for every entry, and only dilute the
	 * match until a path that plainly fits falls under the threshold.
	 */
	matchNames: <T extends { path: string; is_dir: boolean }>({
		entries,
		root,
		query,
		maxResults = 10,
	}: {
		entries: T[];
		root?: string;
		query: string;
		maxResults?: number;
	}): T[] => {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) return [];

		const targets = entries.map((entry) => ({
			entry,
			name: PathUtils.name(entry),
			path: root
				? PathUtils.relative({ base: root, path: entry.path })
				: PathUtils.normalize({ path: entry.path, unix: true }),
		}));

		const matches = fuzzysort.go(normalizedQuery, targets, {
			keys: ["name", "path"],
			limit: maxResults,
			// Well below the default, which only admits near-exact matches. A
			// picker is reached for precisely when the name is half-remembered,
			// so `usrservice` has to still find `UserService.ts`.
			threshold: 0.2,
			// The name is what the user typed at; the path only breaks ties.
			scoreFn: (result) =>
				Math.max(result[0]?.score ?? 0, (result[1]?.score ?? 0) * 0.5),
		});

		return matches.map(({ obj }) => obj.entry);
	},

	searchFiles: async ({
		shell,
		path,
		query,
		include,
		maxResults = 10,
	}: {
		shell: Pick<ShellCapability, "readDir" | "readFile"> &
			Partial<Pick<ShellCapability, "readFiles" | "walk">>;
		path: string;
		query: string;
		include?: string;
		maxResults?: number;
	}) =>
		await FileSearchService.search({
			shell,
			path,
			query,
			include,
			maxResults,
		}),

	grepFiles: async ({
		shell,
		path,
		query,
		literal,
		caseSensitive,
		include,
		context,
		maxResults = 10,
	}: {
		shell: Pick<ShellCapability, "readDir" | "readFile"> &
			Partial<Pick<ShellCapability, "readFiles" | "walk">>;
		path: string;
		query: string;
		literal?: boolean;
		caseSensitive?: boolean;
		include?: string;
		context?: number;
		maxResults?: number;
	}) =>
		await FileSearchService.grep({
			shell,
			path,
			query,
			literal,
			caseSensitive,
			include,
			context,
			maxResults,
		}),

	/**
	 * Resolves an edit against the file on disk without writing it, so a call
	 * that could never land can be rejected before it is applied or approved.
	 * Throws the same explanations `editFile` would.
	 */
	resolveEdit: async ({
		shell,
		path,
		old_string,
		new_string,
		replace_all,
	}: {
		shell: Pick<ShellCapability, "readFile">;
		path: string;
		old_string: string;
		new_string: string;
		replace_all?: boolean;
	}): Promise<{ path: string; edit: FileEditResult }> => {
		const file = await shell.readFile({ path });
		const content = FileUtils.getTextFromBytes(file);
		if (content === null)
			throw new Error(`Cannot read file as text: ${file.path}`);

		return {
			path: file.path,
			edit: FileEditUtils.apply({
				content,
				old_string,
				new_string,
				replace_all,
			}),
		};
	},

	editFile: async ({
		shell,
		path,
		old_string,
		new_string,
		replace_all,
	}: {
		shell: Pick<ShellCapability, "readFile" | "writeFile">;
		path: string;
		old_string: string;
		new_string: string;
		replace_all?: boolean;
	}) => {
		const { path: resolved, edit } = await FileOperationService.resolveEdit({
			shell,
			path,
			old_string,
			new_string,
			replace_all,
		});
		const written = await shell.writeFile({
			path: resolved,
			content: edit.content,
		});

		return {
			path: written.path,
			success: true as const,
			replacements: edit.replacements,
			/** Where the first replacement landed, so the edit can be verified. */
			preview: FileOperationService.getEditPreview({
				content: edit.content,
				new_string,
			}),
		};
	},

	/**
	 * The edited region with a few lines of context, numbered. Cheap for the
	 * model to check, and it removes the reflex to re-read the whole file.
	 */
	getEditPreview: ({
		content,
		new_string,
	}: {
		content: string;
		new_string: string;
	}): string => {
		const index = new_string.length ? content.indexOf(new_string) : -1;
		const lines = content.split("\n");

		const target =
			index === -1 ? 1 : content.slice(0, index).split("\n").length;
		const added = new_string.length ? new_string.split("\n").length : 1;

		const start = Math.max(1, target - EDIT_CONTEXT_LINES);
		const end = Math.min(lines.length, target + added - 1 + EDIT_CONTEXT_LINES);

		return lines
			.slice(start - 1, end)
			.map((line, offset) => {
				const number = start + offset;
				const text =
					line.length > 200
						? `${line.slice(0, 200)}…`
						: line.replace(/\s+$/, "");
				return text ? `${number}: ${text}` : `${number}:`;
			})
			.join("\n");
	},
} as const;
