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

export const grep_files = {
	name: "grep_files",
	description:
		"Search file contents for a regular expression and return the matching lines with their line numbers. Use this when you know what the code says; use search_files when you only know what it does. This reads text, so images, archives, databases, build output, generated and git-ignored files are all skipped — reach for glob_files when you need to know those exist.",
	input: z.object({
		path: z.string().describe("Directory or file to search."),
		query: z
			.string()
			.describe(
				"Regular expression to match against each line. Case-insensitive unless it contains a capital letter.",
			),
		literal: z
			.boolean()
			.optional()
			.describe(
				"Match the query as plain text instead of a regular expression.",
			),
		case_sensitive: z
			.boolean()
			.optional()
			.describe("Force case sensitivity on or off instead of inferring it."),
		include: z
			.string()
			.optional()
			.describe(
				'Glob limiting which files are searched, e.g. "*.ts" or "src/**/*.test.ts".',
			),
		context: z
			.number()
			.optional()
			.describe("Lines of context to show around each match (0-5, default 0)."),
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

const display: ToolDisplay<typeof grep_files> = {
	status: ({ input }) => [
		["Grepping", "Grepped"],
		{ count: ["pattern", "patterns"], subject: input.query ?? "" },
		"in",
		{ subject: ToolDisplayUtils.name(input.path) },
	],
	output: ({ output }) =>
		output.map((file) =>
			ToolDisplayUtils.text({ path: file.path, content: file.snippet }),
		),
};

export const createGrepFilesTool: ToolFactory<
	Tool<typeof grep_files, Pick<Capabilities, "shell" | "chatShell">>
> = (options) => ({
	...grep_files,
	...options,
	display,
	execute: async ({ input }) => {
		const shell = ShellUtils.detect(input.path, options.capabilities);

		const { results, summary } = await FileOperationService.grepFiles({
			shell,
			path: input.path,
			query: input.query,
			literal: input.literal,
			caseSensitive: input.case_sensitive,
			include: input.include,
			context: Math.min(5, Math.max(0, input.context ?? 0)),
			maxResults: Math.min(30, Math.max(1, input.max_results ?? 10)),
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
