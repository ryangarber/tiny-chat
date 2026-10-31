import type { ProviderV3, ProviderV4 } from "@ai-sdk/provider";
import type { EmbeddingModel, LanguageModel, TextStreamPart } from "ai";
import { z } from "zod";
import { Enum } from "#core/core/services/PostgresService.ts";
import type { PromiseOrValue } from "#core/core/types/common.ts";
import type { zProviderEnv } from "#core/core/types/env.ts";
import type {
	zAgentContext,
	zAgentEvent,
} from "#core/features/agent/types/agent.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import {
	zData,
	type zDataPart,
	type zInterjectionPart,
	type zSignature,
	type zToolCallPart,
	type zToolResultPart,
} from "#core/features/data/types/part.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import type {
	Provider,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import type { ToolDefinition } from "#core/features/tool/types/tool.ts";

export const zModelFeature = z.enum([
	"language",
	"language:tools",
	"embedding",
]);
export type zModelFeature = z.infer<typeof zModelFeature>;

export const zModelArg = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("list"),
		name: z.string(),
		values: z.array(z.string()),
		default: z.string(),
	}),
	z.object({
		type: z.literal("range"),
		name: z.string(),
		min: z.number(),
		max: z.number(),
		default: z.number(),
	}),
	z.object({
		type: z.literal("toggle"),
		name: z.string(),
		default: z.boolean(),
	}),
]);
export type zModelArg = z.infer<typeof zModelArg>;

export const zModel = z.object({
	name: z.string(),
	features: z.array(zModelFeature),
	args: z.array(zModelArg),
});
export type zModel = z.infer<typeof zModel>;

export const zModelMessage = z.object({
	author: z.enum(Enum.Author.values),
	data: zData,
});
export type zModelMessage = z.infer<typeof zModelMessage>;

export interface ModelProviderStatus extends ProviderStatus {
	models: zModel[];
}

export interface ModelProvider<T extends ProviderV3 | ProviderV4>
	extends Provider<ModelProviderStatus> {
	type: "model";

	/**
	 * Get the SDK instance for the given user, model, and environment.
	 */
	getSdk: (args: {
		user: zUser;
		model: string;
		env: Partial<zProviderEnv>;
	}) => T | null;

	getSdkOptions: (args: {
		user: zUser;
		config: zConfig;
		env: Partial<zProviderEnv>;
	}) => Record<string, any> | undefined;

	getModelArgs: (args: { model: string }) => zModelArg[];

	getLanguageModel: (args: {
		user: zUser;
		model: string;
		env: Partial<zProviderEnv>;
	}) => LanguageModel | null;

	getEmbeddingModel: (args: {
		user: zUser;
		model: string;
		env: Partial<zProviderEnv>;
	}) => EmbeddingModel | null;

	getPartTransformed?: (args: {
		user: zUser;
		config: zConfig;
		part: zDataPart;
	}) => PromiseOrValue<zDataPart[] | undefined>;

	getPartSignature?: (args: {
		user: zUser;
		config: zConfig;
		event: TextStreamPart<any>;
	}) => zSignature | undefined;

	getPartSignatureReturn?: (args: {
		user: zUser;
		config: zConfig;
		part: zDataPart;
	}) => Record<string, any> | undefined;

	/**
	 * Runs a whole generation as an agent with its own loop, in place of a
	 * single model step at a time. Its calls arrive with their results, so the
	 * generation does not run them; Tiny Chat's own tools run through
	 * `executeTool`, and the agent's own ones ask `approve` first.
	 */
	runAgent?: (args: AgentRunArgs) => AsyncGenerator<zAgentEvent>;
}

export interface AgentRunArgs {
	user: zUser;
	/** The chat the generation is for, whose settings and rules apply. */
	context: zAgentContext;
	config: zConfig;
	/** The chat, ending with the user's prompt and then the reply being made. */
	messages: zModelMessage[];
	system?: string;
	/** Tiny Chat's enabled tools, by the name the model calls them. */
	tools: ToolDefinition[];
	/**
	 * The chat's local folders, the primary one first, where a local agent
	 * runs and works. Empty without any.
	 */
	folders: string[];
	/** Validates, waits on the user where needed, and runs one of Tiny Chat's calls. */
	executeTool: (part: zToolCallPart) => Promise<zToolResultPart>;
	/** Asks the user to approve one of the agent's own calls. */
	approve: (part: zToolCallPart) => Promise<boolean>;
	/**
	 * Waits on the user's answer to one of the agent's own calls that asks them
	 * something, as its display's fields; undefined if none comes.
	 */
	answer: (part: zToolCallPart) => Promise<Record<string, string> | undefined>;
	/**
	 * Shows what one of the agent's own calls does while it runs — a
	 * subagent's conversation — in place of what it showed before.
	 *
	 * [yes apparently genius opus 5.5 made 'stream' the name of a specific provider's SUBAGENT-specific path. zero energy to fix it now.]
	 */
	stream?: (part: zToolCallPart, data: zData) => void;
	/** Aborts once the user stops one of the agent's own calls while it runs. */
	signal?: (part: zToolCallPart) => AbortSignal | undefined;
	/** Takes the messages the user queued meanwhile, for the agent to read next. */
	interjections?: () => zInterjectionPart[] | Promise<zInterjectionPart[]>;
	abortSignal?: AbortSignal;
}
