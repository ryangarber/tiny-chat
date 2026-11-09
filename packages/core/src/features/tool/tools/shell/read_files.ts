import { z } from "zod";
import type { Capabilities } from "#core/core/types/capability.ts";
import type { DistributiveOmit } from "#core/core/types/common.ts";
import { FileOperationService } from "#core/features/file/services/FileOperationService.ts";
import { FileSearchService } from "#core/features/file/services/FileSearchService.ts";
import { FileExcludeUtils } from "#core/features/file/utils/FileExcludeUtils.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type {
	ToolBlock,
	ToolDisplay,
} from "#core/features/tool/types/display.ts";
import type {
	OutputPart,
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

/** Bytes of a non-text file that may be pulled into the conversation. */
const MAX_BINARY_BYTES = 5_000_000;

/** Entries a listing returns before it starts costing more than it explains. */
const MAX_ENTRIES = 200;

const zReadEntry = z.object({
	path: z.string(),
	is_dir: z.boolean(),
	/** Why a directory is shown but its contents are not. */
	not_expanded: z.string().optional(),
});

export const zFileRead = z.object({
	path: z.string().describe("Absolute path of a file or directory."),
	offset: z
		.number()
		.optional()
		.describe("File: first line to read, 1-based (default 1)."),
	limit: z.number().optional().describe("File: lines to read (default 1000)."),
	line_numbers: z
		.boolean()
		.optional()
		.describe("File: prefix each line with its number (default false)."),
	recursive: z
		.boolean()
		.optional()
		.describe(
			"Directory: list every descendant instead of the immediate children. Dependency and version-control directories are listed but not expanded.",
		),
	max_results: z
		.number()
		.optional()
		.describe("Directory: entries to return at most (default 200)."),
});

export const read_files = {
	name: "read_files",
	description:
		"Read files and list directories. Put every path you want into one call; each is read independently, so one that fails does not stop the rest. A text file comes back as a window of lines (pass offset and limit to page through anything larger), an image or document whole, and a directory as its entries. Use search_files first when you only need part of a long file.",
	input: z.object({
		reads: z.array(zFileRead).min(1),
	}),
	/**
	 * One header per read, in order: a directory's entries, an error, or — for
	 * a file — just its path, with the file itself as the next file part.
	 */
	output: z.object({
		path: z.string(),
		entries: z.array(zReadEntry).optional(),
		error: z.string().optional(),
	}),
} as const satisfies ToolDefinition;

type Read = z.infer<typeof read_files.input>["reads"][number];
type Part = DistributiveOmit<OutputPart<typeof read_files>, "id">;

const display: ToolDisplay<typeof read_files> = {
	status: ({ input, output }) => {
		const paths = [
			...new Set(input.reads?.flatMap((read) => read?.path ?? []) ?? []),
		];
		const listed =
			paths.length > 0 &&
			output.length === paths.length &&
			output.every((read) => read.entries);
		return listed
			? ToolDisplayUtils.status.paths({
					verb: ["Browsing", "Browsed"],
					paths,
					count: ["folder", "folders"],
				})
			: ToolDisplayUtils.status.paths({ verb: ["Reading", "Read"], paths });
	},
	output: ({ output, files }) => {
		// Every successful file read is followed by its file part, in order.
		let next = 0;
		return output.flatMap((read): ToolBlock[] => {
			if (read.error)
				return [
					{ type: "text", value: `${read.path}: ${read.error}`, tone: "error" },
				];
			if (read.entries)
				return ToolDisplayUtils.directory({
					path: read.path,
					entries: read.entries,
				});
			const file = files[next++];
			return file
				? [ToolDisplayUtils.file({ path: read.path, file }) ?? []].flat()
				: [];
		});
	},
};

type Shell = ReturnType<typeof ShellUtils.detect>;

/** A text file's lines as a read asks for them: numbered if wanted, then windowed. */
export const getReadWindow = ({
	read,
	path,
	content,
}: {
	read: Pick<Read, "offset" | "limit" | "line_numbers">;
	path: string;
	content: string;
}) => {
	if (read.line_numbers) {
		content = content
			.split("\n")
			.map((line, index) => `${index + 1}. ${line}`)
			.join("\n");
	}
	return FileOperationService.getTextWindow({
		path,
		content,
		offset: read.offset,
		limit: read.limit,
	});
};

const readFile = async (shell: Shell, read: Read): Promise<Part[]> => {
	const file = await shell.readFile({ path: read.path });
	const mime = await FileTypeUtils.getMime(file);
	const data = FileUtils.getBufferFromBytes(file);

	// Images and other binaries are passed through whole — there is no useful
	// way to window them — but never at a size that would swamp the context.
	if (FileExcludeUtils.isBinary({ data })) {
		if (data.length > MAX_BINARY_BYTES) {
			throw new Error(
				`${file.path} is a ${mime} file of ${data.length} bytes, too large to read into the conversation.`,
			);
		}
		return [
			{ type: "json", value: { path: read.path } },
			{
				type: "file",
				name: PathUtils.name(file),
				mime,
				data: FileUtils.getBase64FromBytes({ data }),
			},
		];
	}

	// Not binary, but not cleanly decodable either — an unknown encoding or a
	// few stray bytes. Reading it with replacement characters is far more
	// useful than refusing to read it at all.
	const content =
		FileUtils.getTextFromBytes({ data, mime }) ??
		new TextDecoder().decode(data);

	const window = getReadWindow({ read, path: file.path, content });

	return [
		{ type: "json", value: { path: read.path } },
		{
			type: "file",
			name: PathUtils.name(file),
			mime,
			data: FileUtils.getBase64FromBytes({
				data: new TextEncoder().encode(window.text),
			}),
		},
		...(window.notice ? [{ type: "text" as const, value: window.notice }] : []),
	];
};

const readDir = async (shell: Shell, read: Read): Promise<Part[]> => {
	const limit = Math.min(1_000, Math.max(1, read.max_results ?? MAX_ENTRIES));

	// Listing one directory shows all of it: the caller named the directory,
	// so there is nothing here they did not ask for. Only a recursive walk
	// holds back, and only from descending — every entry is still reported.
	const entries: { path: string; is_dir: boolean; skipped?: string }[] =
		read.recursive
			? (
					await FileSearchService.walk({
						shell,
						path: read.path,
						scope: "listing",
						includeDirectories: true,
					})
				).entries
			: await shell.readDir({ path: read.path });

	// Directories first, then names, so a listing reads like a file tree.
	const sorted = entries.sort(
		(a, b) =>
			Number(b.is_dir) - Number(a.is_dir) ||
			PathUtils.normalize({ path: a.path, unix: true }).localeCompare(
				PathUtils.normalize({ path: b.path, unix: true }),
			),
	);

	return [
		{
			type: "json",
			value: {
				path: read.path,
				entries: sorted.slice(0, limit).map(({ path, is_dir, skipped }) => ({
					path,
					is_dir,
					...(skipped ? { not_expanded: skipped } : {}),
				})),
			},
		},
		...(sorted.length > limit
			? [
					{
						type: "text" as const,
						value: `Showing ${limit} of ${sorted.length} entries in ${read.path}. Use search_files or glob_files to find what you need instead of listing the rest.`,
					},
				]
			: []),
	];
};

/**
 * Whether a path that would not read as a file is a directory. Shells disagree
 * on what listing a missing path or a file does — some fail, some list
 * nothing — so an empty listing is only trusted when the parent agrees.
 */
const isDirectory = async (shell: Shell, path: string) => {
	if ((await shell.readDir({ path })).length) return true;
	const trimmed = path.replace(/(.)[\\/]+$/, "$1");
	const name = PathUtils.name(trimmed);
	const parent = trimmed
		.slice(0, trimmed.length - name.length)
		.replace(/(.)[\\/]+$/, "$1");
	if (!name || !parent || parent === trimmed) return false;
	const siblings = await shell.readDir({ path: parent }).catch(() => []);
	return siblings.some(
		(entry) => entry.is_dir && PathUtils.name(entry.path) === name,
	);
};

/** A file, or failing that a directory, unless the read only makes sense as one. */
const readPath = async (shell: Shell, read: Read) => {
	if (read.recursive || read.max_results !== undefined)
		return await readDir(shell, read);
	try {
		return await readFile(shell, read);
	} catch (error) {
		if (await isDirectory(shell, read.path).catch(() => false))
			return await readDir(shell, read);
		throw error;
	}
};

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

export const createReadFilesTool: ToolFactory<
	Tool<typeof read_files, Pick<Capabilities, "shell" | "chatShell">>
> = (options) => ({
	...read_files,
	...options,
	display,
	execute: async ({ input }) => {
		const results = await Promise.allSettled(
			input.reads.map(async (read) =>
				readPath(ShellUtils.detect(read.path, options.capabilities), read),
			),
		);

		// A call that read nothing fails outright, as a single read always has.
		if (results.every((result) => result.status === "rejected")) {
			throw new Error(
				results
					.map((result, index) =>
						results.length > 1
							? `${input.reads[index]?.path}: ${message(result.reason)}`
							: message(result.reason),
					)
					.join("\n"),
			);
		}

		return results.flatMap((result, index): Part[] =>
			result.status === "fulfilled"
				? result.value
				: [
						{
							type: "json",
							value: {
								path: input.reads[index]?.path ?? "",
								error: message(result.reason),
							},
						},
					],
		);
	},
});
