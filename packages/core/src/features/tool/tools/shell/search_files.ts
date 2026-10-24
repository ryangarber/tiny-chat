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
		"Find the files most relevant to a description or set of keywords, ranked by how well their path and contents match. Use this to locate where something lives; use grep_files once you know the exact text to match. This reads text, so images, archives, databases, build output, generated and git-ignored files are all skipped — reach for glob_files when you need to know those exist.",
	input: z.object({
		path: z.string().describe("Directory to search."),
		query: z
			.string()
			.describe(
				"Keywords, an identifier, or a short description of what you are looking for.",
			),
		include: z
			.string()
			.optional()
			.describe(
				'Glob limiting which files are searched, e.g. "*.ts" or "src/**/*.test.ts".',
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
	status: ({ input }) => [
		["Searching files for", "Searched files for"],
		{ count: ["query", "queries"], subject: input.query ?? "" },
	],
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

		const { results, summary } = await FileOperationService.searchFiles({
			shell,
			path: input.path,
			query: input.query,
			include: input.include,
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
