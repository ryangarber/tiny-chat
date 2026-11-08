import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	zData,
	zFileChanges,
	zFilePart,
} from "#core/features/data/types/part.ts";
import { FileExtractionService } from "#core/features/file/services/FileExtractionService.ts";
import { FileExcludeUtils } from "#core/features/file/utils/FileExcludeUtils.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type {
	ToolBlock,
	ToolCallState,
	ToolStatusPiece,
} from "#core/features/tool/types/display.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";
import { ToolOutputUtils } from "#core/features/tool/utils/ToolOutputUtils.ts";

type Noun = [one: string, many: string];

/** `{ subject }`, or nothing until there is one to show. */
const subject = (value: string | undefined): ToolStatusPiece[] =>
	value ? [{ subject: value }] : [];

/** `in <folder>`, once a call names where it looks. */
const within = (path: string | undefined): ToolStatusPiece[] =>
	path ? ["in", { subject: PathUtils.name(path) }] : [];

/** A to-do as Tiny Chat and the agents it runs report them. */
type Todo = { content?: string; status?: string } | undefined;

/**
 * Helpers tools use to describe their calls in `ToolBlock`s. A kind of call
 * looks the same whoever makes it — Tiny Chat's own tools, or Claude Code's,
 * Codex's and Cursor's — so calls of a kind are counted together.
 */
export const ToolDisplayUtils = {
	/** The last segment of a path, safe on the partial input of a streaming call. */
	name: (path: string | undefined): string => {
		return path ? PathUtils.name(path) : "";
	},

	/** Status lines, by the kind of call. */
	status: {
		command: (command: string | undefined): ToolStatusPiece[] => [
			["Running", "Ran"],
			{
				count: ["command", "commands"],
				subject: ShellUtils.programs(command ?? ""),
			},
		],

		/** A call on paths: `Read file a.txt`, or `Edited 3 files`. */
		paths: ({
			verb,
			paths,
			count = ["file", "files"],
		}: {
			verb: [string, string];
			paths: (string | undefined)[];
			count?: Noun;
		}): ToolStatusPiece[] => {
			const unique = [...new Set(paths.filter(Boolean))] as string[];
			if (unique.length > 1)
				return [verb, { count, subject: `${unique.length} ${count[1]}` }];
			return [verb, { count }, ...subject(PathUtils.name(unique[0] ?? ""))];
		},

		glob: (pattern: string | undefined, path?: string): ToolStatusPiece[] => [
			["Looking for", "Looked for"],
			{ count: ["pattern", "patterns"], subject: pattern ?? "" },
			...within(path),
		],

		grep: (pattern: string | undefined, path?: string): ToolStatusPiece[] => [
			["Grepping", "Grepped"],
			{ count: ["pattern", "patterns"], subject: pattern ?? "" },
			...within(path),
		],

		searchFiles: (query: string | undefined): ToolStatusPiece[] => [
			["Searching files for", "Searched files for"],
			{ count: ["query", "queries"], subject: query ?? "" },
		],

		searchWeb: (query: string | undefined): ToolStatusPiece[] => [
			["Searching web for", "Searched web for"],
			{ count: ["query", "queries"], subject: query ?? "" },
		],

		viewWeb: (url: string | undefined): ToolStatusPiece[] => [
			["Reading", "Read"],
			{ count: ["page", "pages"] },
			"at",
			{ subject: url ? PathUtils.name(url) : "" },
		],

		subagent: (task: string | undefined): ToolStatusPiece[] => [
			["Using", "Used"],
			{ count: ["subagent", "subagents"] },
			...subject(task),
		],

		todos: (): ToolStatusPiece[] => [
			["Updating", "Updated"],
			{ count: ["todo list", "todo lists"] },
		],

		plan: (
			verb: [string, string] = ["Proposing", "Proposed"],
		): ToolStatusPiece[] => [verb, { count: ["plan", "plans"] }],

		image: (prompt: string | undefined): ToolStatusPiece[] => [
			["Generating", "Generated"],
			{ count: ["image", "images"], subject: prompt ?? "" },
		],
	},

	/** A change to a file, from the text before it to the text after. */
	diff: ({
		path,
		before,
		after,
	}: {
		path: string | undefined;
		before: string | undefined;
		after: string | undefined;
	}): ToolBlock => ({
		type: "diff",
		path,
		before: before ?? "",
		after: after ?? "",
		language: ToolDisplayUtils.language(path),
	}),

	/** A command a call runs. */
	command: (command: string | undefined, language = "bash"): ToolBlock => ({
		type: "code",
		value: command ?? "",
		language,
		title: "input",
	}),

	/** What a command printed, and how it exited when that was not cleanly. */
	commandOutput: ({
		stdout,
		stderr,
		code,
	}: {
		stdout?: string;
		stderr?: string;
		code?: number | null;
	}): ToolBlock[] => {
		// Results saved before output was cleaned on the way in still carry it.
		const text = [stdout, stderr]
			.map((value) => ToolOutputUtils.getPlain(value ?? "").trim())
			.filter(Boolean)
			.join("\n");
		return [
			...(text
				? [
						{
							type: "code" as const,
							value: text,
							title: "output",
							terminal: true,
						},
					]
				: []),
			...(code
				? [
						{
							type: "text" as const,
							value: `Exited with code ${code}`,
							tone: "dimmed" as const,
						},
					]
				: []),
		];
	},

	/** What a subagent is asked. */
	prompt: (prompt: string | undefined): ToolBlock => ({
		type: "markdown",
		value: prompt ?? "",
		quote: true,
	}),

	/** A subagent's conversation while it runs: the last of what it reported. */
	conversation: ({
		state,
		stream,
	}: {
		state: ToolCallState;
		stream: unknown[];
	}): ToolBlock[] => {
		const data = state === "running" ? stream.at(-1) : undefined;
		return data ? [{ type: "messages", data: data as zData }] : [];
	},

	/** A to-do list as a checklist. */
	todos: (todos: Todo[] | undefined): ToolBlock => ({
		type: "markdown",
		value: (todos ?? [])
			.map((todo) => {
				const content = todo?.content ?? "";
				if (todo?.status === "cancelled") return `- [ ] ~~${content}~~`;
				return `- [${todo?.status === "completed" ? "x" : " "}] ${content}`;
			})
			.join("\n"),
	}),

	/** Paths found or listed in a folder, or nothing when there are none. */
	directory: ({
		path,
		entries,
	}: {
		path: string | undefined;
		entries: (string | { path?: string; is_dir?: boolean } | undefined)[];
	}): ToolBlock[] =>
		entries.length
			? [
					{
						type: "directory",
						path: path ?? "",
						entries: entries.map((entry) =>
							typeof entry === "string"
								? { path: entry }
								: { path: entry?.path ?? "", directory: !!entry?.is_dir },
						),
					},
				]
			: [],

	language: (path: string | undefined): string | undefined => {
		return path ? FileTypeUtils.getLanguage({ path }) : undefined;
	},

	date: (date: Date | string | null | undefined): string | undefined => {
		if (!date) return undefined;
		return CommonUtils.formatDate({ date: new Date(date), relative: true });
	},

	/** A file part as text, an image or a document, or nothing when it is none. */
	file: ({
		path,
		file,
	}: {
		path?: string;
		file: zFilePart;
	}): ToolBlock | undefined => {
		path ||= file.name ?? "";
		if (file.mime.startsWith("image/")) {
			return {
				type: "file",
				path,
				image: `data:${file.mime};base64,${file.data}`,
			};
		}
		if (
			FileExtractionService.canExtract({
				name: path ? PathUtils.name(path) : file.name,
				mime: file.mime,
			})
		) {
			return {
				type: "file",
				path,
				document: { data: file.data, mime: file.mime },
				language: "markdown",
			};
		}
		const content = FileUtils.getTextFromBytes(file);
		if (content === null) return undefined;
		return {
			type: "file",
			path,
			content,
			language: FileTypeUtils.getLanguage({ mime: file.mime, path }),
		};
	},

	/**
	 * Files a call changed, as diffs, and one line naming those with nothing
	 * to show: lockfiles, generated or binary files, and any past the limits.
	 */
	changes: (changes: zFileChanges | undefined): ToolBlock[] => {
		if (!changes?.files.length) return [];
		const blocks: ToolBlock[] = [];
		const names: string[] = [];
		for (const file of changes.files) {
			if (file.skipped) {
				const reason =
					file.skipped in FileExcludeUtils.reasons
						? FileExcludeUtils.reasons[
								file.skipped as keyof typeof FileExcludeUtils.reasons
							]
						: undefined;
				names.push(
					reason
						? `${ToolDisplayUtils.name(file.path)} (${reason})`
						: ToolDisplayUtils.name(file.path),
				);
				continue;
			}
			blocks.push({
				type: "diff",
				path: file.path,
				before: file.before ?? "",
				after: file.after ?? "",
				language: ToolDisplayUtils.language(file.path),
			});
		}
		if (changes.omitted)
			names.push(
				`${changes.omitted} more ${changes.omitted === 1 ? "file" : "files"}`,
			);
		if (names.length)
			blocks.push({
				type: "text",
				value: `${blocks.length ? "Also changed" : "Changed"} ${names.join(", ")}`,
				tone: "dimmed",
			});
		return blocks;
	},

	/** Text content for a file, typed as it is being streamed in. */
	/** A bulk tool's failed step and what it skipped; what landed is shown by the input. */
	steps: <T extends { error?: string }>(
		output: { steps: T[]; skipped?: number }[],
		label: (step: T) => string,
	): ToolBlock[] =>
		output.flatMap((result) => [
			...result.steps.flatMap((step): ToolBlock[] =>
				step.error
					? [
							{
								type: "text",
								value: `${label(step)}: ${step.error}`,
								tone: "error",
							},
						]
					: [],
			),
			...(result.skipped
				? [
						{
							type: "text" as const,
							value: `Skipped ${result.skipped} later ${result.skipped === 1 ? "step" : "steps"}`,
							tone: "dimmed" as const,
						},
					]
				: []),
		]),

	text: ({
		path,
		content,
	}: {
		path: string | undefined;
		content: string | undefined;
	}): ToolBlock => {
		return {
			type: "file",
			path: path ?? "",
			content: content ?? "",
			language: ToolDisplayUtils.language(path),
		};
	},
} as const;
