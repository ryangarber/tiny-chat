import { z } from "zod";

const zPath = z.string().describe("Absolute path of the file.");

export const zFileWriteStep = z
	.object({
		action: z.literal("write"),
		path: zPath,
		content: z.string(),
	})
	.describe(
		"Create a file, or replace all of it. Prefer `edit` for a file that exists.",
	);

export const zFileEditStep = z
	.object({
		action: z.literal("edit"),
		path: zPath,
		old_string: z
			.string()
			.describe(
				"Text to replace, copied from the file with enough surrounding lines to appear exactly once.",
			),
		new_string: z
			.string()
			.describe(
				"Text to put in its place. Use an empty string to delete old_string.",
			),
		replace_all: z
			.boolean()
			.optional()
			.describe(
				"Replace every occurrence instead of failing when old_string is not unique.",
			),
	})
	.describe("Replace a snippet of an existing file.");

export const zFileRenameStep = z
	.object({
		action: z.literal("rename"),
		path: zPath,
		to: z.string().describe("Absolute path to move it to."),
	})
	.describe("Move or rename a file or directory.");

export const zFileDeleteStep = z
	.object({
		action: z.literal("delete"),
		path: zPath,
	})
	.describe("Delete a file, or a directory and everything in it.");

export const zFileStep = z.discriminatedUnion("action", [
	zFileWriteStep,
	zFileEditStep,
	zFileRenameStep,
	zFileDeleteStep,
]);
export type zFileStep = z.infer<typeof zFileStep>;

export const zFileStepResult = z.object({
	action: z.enum(["write", "edit", "rename", "delete"]),
	path: z.string(),
	to: z.string().optional(),
	replacements: z.number().optional(),
	/** Where an edit landed, numbered, so it can be checked without a re-read. */
	preview: z.string().optional(),
	error: z.string().optional(),
});
export type zFileStepResult = z.infer<typeof zFileStepResult>;
