import z from "zod";
import type { Model } from "#core/core/services/PostgresService.ts";
import type { zData } from "#core/features/data/types/part.ts";

const DEFAULT_TOOLSETS = [
	"actions",
	"browser",
	"github",
	"legiscan",
	"memories",
	"questions",
	"shell",
	"subagents",
	"web",
];

const DEFAULT_SKILLS: string[] = [];

/**
 * A message as it travels: its embedding and the provider metadata of its
 * generations stay on the server, which is the only place either is used.
 */
export type MessageState = Omit<Model["Message"], "embedding" | "metadata"> & {
	config: zConfig;
	data: zData;
};

export type MessageSearchResult = Pick<
	MessageState,
	"id" | "chatId" | "author" | "data" | "createdAt" | "updatedAt"
> & { chatTitle: string | null };

export type MessageLike = { id: string } | string;
export const MessageLike = z.custom<MessageLike>();

export const zConfig = z.object({
	provider: z.string(),
	model: z.string(),
	schema: z.any().nullish(), // z.custom<ZodStandardJSONSchemaPayload<any>>()
	args: z
		.any()
		.nullish()
		.transform((args) => args ?? {}),
	toolsets: z
		.array(z.string())
		.nullish()
		.transform((toolsets) => toolsets ?? DEFAULT_TOOLSETS),
	skills: z
		.array(z.string())
		.nullish()
		.transform((skills) => skills ?? DEFAULT_SKILLS),
});
export type zConfig = z.infer<typeof zConfig>;
