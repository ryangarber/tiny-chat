import { z } from "zod";
import type { Capabilities } from "#core/core/types/capability.ts";
import { FileSearchService } from "#core/features/file/services/FileSearchService.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

export const glob_files = {
	name: "glob_files",
	description:
		"List the files whose paths match a glob, without reading any of them. The cheapest way to learn how a project is laid out, and the way to find files of any type — images, logs, archives and data files are all listed here, including ones the text search tools will not open. Only version-control, dependency and cache directories are left out.",
	input: z.object({
		path: z.string().describe("Directory to search."),
		pattern: z
			.string()
			.describe(
				'Glob to match against paths relative to `path`, e.g. "**/*.test.ts", "src/**/*.{ts,tsx}" or "Dockerfile".',
			),
		max_results: z
			.number()
			.optional()
			.describe("Paths to return at most (default 100)."),
	}),
	output: z.string(),
} as const satisfies ToolDefinition;

const display: ToolDisplay<typeof glob_files> = {
	status: ({ input }) => [
		["Looking for", "Looked for"],
		{ count: ["pattern", "patterns"], subject: input.pattern ?? "" },
		"in",
		{ subject: ToolDisplayUtils.name(input.path) },
	],
	output: ({ input, output }) =>
		output.length
			? [
					{
						type: "directory",
						path: input.path ?? "",
						entries: output.map((path) => ({ path })),
					},
				]
			: [],
};

export const createGlobFilesTool: ToolFactory<
	Tool<typeof glob_files, Pick<Capabilities, "shell" | "chatShell">>
> = (options) => ({
	...glob_files,
	...options,
	display,
	execute: async ({ input }) => {
		const shell = ShellUtils.detect(input.path, options.capabilities);

		const { paths, truncated, scanned } = await FileSearchService.glob({
			shell,
			path: input.path,
			pattern: input.pattern,
			maxResults: Math.min(500, Math.max(1, input.max_results ?? 100)),
		});

		return [
			...paths.map((path) => ({ type: "json" as const, value: path })),
			...(truncated
				? [
						{
							type: "text" as const,
							value: `Showing ${paths.length} path(s); more matched. Narrow the pattern to see the rest.`,
						},
					]
				: []),
			// An empty result is ambiguous between "wrong glob" and "empty
			// directory", and the two call for opposite next moves.
			...(!paths.length && !truncated
				? [
						{
							type: "text" as const,
							value: scanned
								? `No path matched. ${scanned} file(s) were checked against the pattern, so try a broader one such as "**/*" to see what is there.`
								: "No files were found under this path at all. Check the path itself with read_dir.",
						},
					]
				: []),
		];
	},
});
