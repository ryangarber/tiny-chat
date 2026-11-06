import { zPlainDateTime } from "temporal-zod";
import z from "zod";
import { Enum } from "#core/core/services/PostgresService.ts";
import { zId } from "#core/core/types/common.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import { zData, zDataPart, zMetadata } from "#core/features/data/types/part.ts";
import { zSettings, zUser } from "#core/features/data/types/user.ts";

/**
 * The chat a generation belongs to. `id` is null while the chat is still a
 * draft — nothing has been saved, but the folder it is aimed at already decides
 * the settings, so an estimate can be built before the row exists.
 */
export const zAgentChat = z.object({
	id: zId.nullish(),
	project: z
		.object({
			title: z.string().nullable(),
			settings: zSettings,
		})
		.nullable(),
	incognito: z.boolean(),
	temporary: z.boolean(),
});
export type zAgentChat = z.infer<typeof zAgentChat>;

export const zAgentMessage = z.object({
	id: zId.nullable(),
	author: z.enum(Enum.Author.values),
	data: zData,
	config: zConfig.nullable(),
	createdAt: zPlainDateTime.nullable(),
});
export type zAgentMessage = z.infer<typeof zAgentMessage>;

export const zAgentContext = z.object({
	user: zUser,
	chat: zAgentChat.nullish(),
	messages: z.array(zAgentMessage),
	timezone: z.string(),
	interactive: z.boolean(),
});
export type zAgentContext = z.infer<typeof zAgentContext>;

export const zAgentEvent = z.discriminatedUnion("type", [
	z.object({ type: z.literal("start"), warnings: z.array(z.any()) }),
	z.object({ type: z.literal("data"), value: zDataPart }),
	z.object({ type: z.literal("end"), metadata: zMetadata }),
	/** A call the provider runs itself asks for the user's approval first. */
	z.object({ type: z.literal("approval"), id: z.string() }),
	/** What a call the provider runs shows while it runs, in place of before. */
	z.object({ type: z.literal("toolStream"), id: z.string(), data: zData }),
	/** A tool call's input as the model writes it, before the call is complete. */
	z.object({
		type: z.literal("toolInput"),
		id: z.string(),
		/** Set on the first event of a call. */
		name: z.string().optional(),
		delta: z.string().optional(),
	}),
]);
export type zAgentEvent = z.infer<typeof zAgentEvent>;
