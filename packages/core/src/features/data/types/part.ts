import { z } from "zod";

export const zSignature = z.object({
	model: z.string().optional(),
	item: z.string().optional(),
	reasoning: z.string().optional(),
});
export type zSignature = z.infer<typeof zSignature>;

const _zDataPart = z.object({
	id: z.string(),
	signature: zSignature.optional(),
});

export const zTextPart = _zDataPart.extend({
	type: z.literal("text"),
	value: z.string(),
});
export type zTextPart = z.infer<typeof zTextPart>;

export const zThoughtPart = _zDataPart.extend({
	type: z.literal("thought"),
	value: z.string(),
});
export type zThoughtPart = z.infer<typeof zThoughtPart>;

export const zFilePart = _zDataPart.extend({
	type: z.literal("file"),
	name: z.string().optional(),
	mime: z.string(),
	data: z.base64(),
});
export type zFilePart = z.infer<typeof zFilePart>;

export const zJsonPart = _zDataPart.extend({
	type: z.literal("json"),
	value: z.any(),
});
export type zJsonPart = z.infer<typeof zJsonPart>;

/** @lintignore */
export const zDirectoryPart = _zDataPart.extend({
	type: z.literal("directory"),
	items: z.array(
		z.object({ path: z.string(), directory: z.boolean().optional() }),
	),
});
export type zDirectoryPart = z.infer<typeof zDirectoryPart>;

/** @lintignore */
export const zWebPart = _zDataPart.extend({
	type: z.literal("web"),
	title: z.string().optional(),
	url: z.string(),
	content: z.string(),
});
export type zWebPart = z.infer<typeof zWebPart>;

export const zToolCallPart = _zDataPart.extend({
	type: z.literal("toolCall"),
	name: z.string(),
	input: z.any(),
	validation: z
		.object({
			approval: z.boolean(),
		})
		.partial()
		.optional(),
	/**
	 * The model is still writing `input`, which holds what has been parsed so
	 * far. Only ever seen mid-stream: the loop settles or drops these before a
	 * step ends, so they are never persisted.
	 */
	partial: z.boolean().optional(),
});
export type zToolCallPart = z.infer<typeof zToolCallPart>;

export const zToolResultPart = _zDataPart.extend({
	type: z.literal("toolResult"),
	name: z.string(),
	get output() {
		return zDataSimplePart.array();
	},
	error: z.boolean().optional(),
});
export type zToolResultPart = z.infer<typeof zToolResultPart>;

export const zAbortPart = _zDataPart.extend({
	type: z.literal("abort"),
	reason: z.enum(["user", "content", "length", "error", "other"]),
	message: z.string().optional(),
	details: z.any().optional(),
});
export type zAbortPart = z.infer<typeof zAbortPart>;

export const zAttachmentPart = _zDataPart.extend({
	type: z.literal("attachment"),
	source: z.string(),
	label: z.string(),
	content: z.discriminatedUnion("type", [
		zFilePart.omit({ id: true }),
		zDirectoryPart.omit({ id: true }),
		zWebPart.omit({ id: true, url: true }),
		/** Another chat, read down to the transcript of its current branch. */
		z.object({
			type: z.literal("chat"),
			title: z.string().nullish(),
			transcript: z.string(),
		}),
		z.object({ type: z.literal("unavailable") }),
	]),
});
export type zAttachmentPart = z.infer<typeof zAttachmentPart>;

/**
 * A slash command written into a message rather than run on the client.
 *
 * Only the commands that travel reach here: `/clear` and `/model` act on the
 * client and are taken out of the editor as they are run.
 */
export const zCommandPart = _zDataPart.extend({
	type: z.literal("command"),
	name: z.string(),
	/** What the command is, where that is not its name — `skill:<path>`. */
	value: z.string().optional(),
	/** The argument it was given, for a command that takes one. */
	argument: z.string().optional(),
});
export type zCommandPart = z.infer<typeof zCommandPart>;

export const zQuotePart = _zDataPart.extend({
	type: z.literal("quote"),
	model: z.string().optional(),
	text: z.string(),
});
export type zQuotePart = z.infer<typeof zQuotePart>;

export const zPastePart = _zDataPart.extend({
	type: z.literal("paste"),
	text: z.string(),
	lines: z.number(),
	language: z.string().nullish(),
	/** Whether it is long enough to be shown folded rather than as a block. */
	collapsed: z.boolean().optional(),
});
export type zPastePart = z.infer<typeof zPastePart>;

export const zInterjectionPart = _zDataPart.extend({
	type: z.literal("interjection"),
	get value() {
		return z.array(zDataSimplePart);
	},
	/**
	 * Set when this reports a background tool call finishing rather than
	 * carrying a message from the user: `value` is then the call's output.
	 */
	task: z
		.object({
			id: z.string(),
			name: z.string(),
			error: z.boolean().optional(),
		})
		.optional(),
});
export type zInterjectionPart = z.infer<typeof zInterjectionPart>;

export const zDataPart = z.discriminatedUnion("type", [
	zTextPart,
	zThoughtPart,
	zJsonPart,
	zFilePart,
	zAttachmentPart,
	zCommandPart,
	zQuotePart,
	zPastePart,
	zToolCallPart,
	zToolResultPart,
	zAbortPart,
	zInterjectionPart,
]);
export type zDataPart = z.infer<typeof zDataPart>;

export const zDataSimplePart = z.discriminatedUnion("type", [
	zTextPart,
	zJsonPart,
	zFilePart,
	zAttachmentPart,
]);
export type zDataSimplePart = z.infer<typeof zDataSimplePart>;

export const zData = z.array(z.array(zDataPart));
export type zData = z.infer<typeof zData>;

export const zMetadata = z.array(z.any());
export type zMetadata = z.infer<typeof zMetadata>;
