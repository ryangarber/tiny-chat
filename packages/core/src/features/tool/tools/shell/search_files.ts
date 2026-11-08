import { z } from "zod";
import type { Capabilities } from "#core/core/types/capability.ts";
import { FileOperationService } from "#core/features/file/services/FileOperationService.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

export const search_files = {
	name: "search_files",
	description:
		"Search file contents. `relevance` ranks the files that best match a description or keywords by path and contents — use it to locate where something lives. `regex` and `literal` return every matching line with its line number — use them once you know what the text says. This reads text, so images, archives, databases, build output, generated and git-ignored files are all skipped — reach for glob_files when you need to know those exist.",
	input: z.object({
		path: z.string().describe("Directory or file to search."),
		query: z
			.string()
			.describe(
				"relevance: keywords, an identifier, or a short description. regex: a regular expression matched against each line, case-insensitive unless it contains a capital letter. literal: plain text to match.",
			),
		mode: z
			.enum(["relevance", "regex", "literal"])
			.optional()
			.describe("How to match `query` (default relevance)."),
		include: z
			.string()
			.optional()
			.describe(
				'Glob limiting which files are searched, e.g. "*.ts" or "src/**/*.test.ts".',
			),
		case_sensitive: z
			.boolean()
			.optional()
			.describe(
				"regex/literal: force case sensitivity on or off instead of inferring it.",
			),
		context: z
			.number()
			.optional()
			.describe(
				"regex/literal: lines of context to show around each match (0-5, default 0).",
			),
		max_results: z
			.number()
			.optional()
			.describe("Files to return at most (default 10, maximum 30)."),
	}),
	output: z.object({
		path: z.string(),
		snippet: z.string(),
		matches: z.number().optional(),
	}),
} as const satisfies ToolDefinition;

const display: ToolDisplay<typeof search_files> = {
	status: ({ input }) =>
		!input.mode || input.mode === "relevance"
			? ToolDisplayUtils.status.searchFiles(input.query)
			: ToolDisplayUtils.status.grep(input.query, input.path),
	output: ({ output }) =>
		output.map((file) =>
			ToolDisplayUtils.text({ path: file.path, content: file.snippet }),
		),
};

export const createSearchFilesTool: ToolFactory<
	Tool<typeof search_files, Pick<Capabilities, "shell" | "chatShell">>
> = (options) => ({
	...search_files,
	...options,
	display,
	execute: async ({ input }) => {
		const shell = ShellUtils.detect(input.path, options.capabilities);
		const maxResults = Math.min(30, Math.max(1, input.max_results ?? 10));

		const { results, summary } =
			!input.mode || input.mode === "relevance"
				? await FileOperationService.searchFiles({
						shell,
						path: input.path,
						query: input.query,
						include: input.include,
						maxResults,
					})
				: await FileOperationService.grepFiles({
						shell,
						path: input.path,
						query: input.query,
						literal: input.mode === "literal",
						caseSensitive: input.case_sensitive,
						include: input.include,
						context: Math.min(5, Math.max(0, input.context ?? 0)),
						maxResults,
					});

		return [
			...results.map((file) => ({
				type: "json" as const,
				value: {
					path: file.path,
					snippet: file.snippet,
					matches: file.matches,
				},
			})),
			{ type: "text" as const, value: summary },
		];
	},
});
