import type { ProviderV3, ProviderV4 } from "@ai-sdk/provider";
import type {
	EmbeddingModel,
	LanguageModel,
	Tool as SdkTool,
	TextStreamPart,
} from "ai";
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
	type zSignature,
	type zToolCallPart,
} from "#core/features/data/types/part.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import type {
	Provider,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import type { Tool } from "#core/features/tool/types/tool.ts";

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
		/** The chat the generation is for, whose project's settings apply. */
		context?: zAgentContext;
		/** The chat's local folders, the primary one first. */
		folders?: string[];
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
	 * What a provider keeps of the conversation itself (Claude Code's
	 * session), so the chat sent to it is never compacted.
	 */
	keepsContext?: boolean;

	/**
	 * Tools only the provider's model calls that Tiny Chat answers, such as
	 * Claude Code's own questions. Never offered to other models.
	 */
	getTools?: (args: { config: zConfig }) => Tool<any, any>[];

	/** The provider's own tools to declare for a step, beside Tiny Chat's. */
	getSdkTools?: (args: { config: zConfig }) => Record<string, SdkTool>;

	/**
	 * Whether a step's model may run tools of its own (Claude Code's, Codex's)
	 * without Tiny Chat running them. What those change is then found by
	 * comparing the user's repositories from the start of the step, since such
	 * a call can be running before Tiny Chat hears of it.
	 */
	runsTools?: (args: { config: zConfig }) => boolean;

	/**
	 * A stream's event as the generation's events, where the provider reads it
	 * its own way; undefined to read it as any other.
	 */
	getEventTransformed?: (args: {
		user: zUser;
		config: zConfig;
		event: TextStreamPart<any>;
	}) => zAgentEvent[] | undefined;

	/**
	 * Whether the generation goes on after a step that called nothing, from
	 * the step's events: the provider has more to stream (work in the
	 * background that will report in).
	 */
	shouldContinue?: (args: { events: TextStreamPart<any>[] }) => boolean;

	/** Stops one of the provider's own calls while it runs (a subagent). */
	stopToolCall?: (args: { part: zToolCallPart }) => PromiseOrValue<void>;
}
