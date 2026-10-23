import {
	embedMany,
	Output,
	streamText,
	type TextStreamPart,
	type Tool,
} from "ai";
import { z } from "zod";
import type { zClientEnv } from "#core/core/types/env.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { AnthropicProvider } from "#core/features/provider/providers/model/AnthropicProvider.ts";
import { AntigravityProvider } from "#core/features/provider/providers/model/AntigravityProvider.ts";
import { AwsProvider } from "#core/features/provider/providers/model/AwsProvider.ts";
import { AzureProvider } from "#core/features/provider/providers/model/AzureProvider.ts";
import { CustomProvider } from "#core/features/provider/providers/model/CustomProvider.ts";
import { GoogleProvider } from "#core/features/provider/providers/model/GoogleProvider.ts";
import { OpenAiProvider } from "#core/features/provider/providers/model/OpenAiProvider.ts";
import { TestProvider } from "#core/features/provider/providers/model/TestProvider.ts";
import { VoyageProvider } from "#core/features/provider/providers/model/VoyageProvider.ts";
import { ModelTransformService } from "#core/features/provider/services/ModelTransformService.ts";
import type {
	ModelProvider,
	zModelMessage,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";
import type { ToolDefinition } from "#core/features/tool/types/tool.ts";
import { VERBOSE } from "#core/logger.ts";

export type RunLanguageModelOptions = Omit<
	Parameters<typeof streamText>[0],
	| "model"
	| "prompt"
	| "tools"
	| "messages"
	| "providerOptions"
	| "temperature"
	| "maxOutputTokens"
>;

export const ModelProviderService = {
	providers: [
		AnthropicProvider,
		AntigravityProvider,
		AwsProvider,
		AzureProvider,
		CustomProvider,
		GoogleProvider,
		OpenAiProvider,
		TestProvider,
		VoyageProvider,
	] satisfies ModelProvider<any>[],

	runLanguageModel: async function* ({
		user,
		provider,
		messages,
		config,
		tools,
		env,
		options = {},
	}: {
		user: zUser;
		provider: ModelProvider<any>;
		messages: zModelMessage[];
		config: zConfig;
		tools: ToolDefinition[];
		env: Partial<zClientEnv>;
		options?: Partial<RunLanguageModelOptions>;
	}): AsyncGenerator<zAgentEvent> {
		const model = (await provider.getStatus({ user })).models.find(
			(m) => m.name === config.model,
		);
		const sdkModel = provider.getLanguageModel({
			user,
			model: config.model,
			env,
		});
		if (!model || !sdkModel)
			throw new Error(`model not found: ${config.model}`);

		config = ModelProviderUtils.applyDefaultArgs({ config, args: model.args });

		const events: TextStreamPart<any>[] = [];

		const sdkMessages = await ModelTransformService.toSdkMessages({
			user,
			config,
			provider,
			messages,
		});

		const sdkTools = model.features.includes("language:tools")
			? Object.fromEntries(
					tools.map((tool) => [
						tool.name,
						{
							description: tool.description,
							inputSchema: tool.input as z.ZodType,
						} satisfies Tool,
					]),
				)
			: undefined;

		const input = {
			...options,
			model: sdkModel,
			maxOutputTokens: config.args?.["tokens-out"],
			temperature: config.args?.temperature as number,
			providerOptions: provider?.getSdkOptions({ user, config, env }),
			output: config.schema
				? Output.object({ schema: z.fromJSONSchema(config.schema) })
				: undefined,
			tools: sdkTools,
			messages: sdkMessages,
		} satisfies Parameters<typeof streamText>[0];

		if (VERBOSE) console.log("[ModelProviderService] final sdk input:", input);

		const { stream, output } = streamText(input);
		// Only read with a schema; otherwise its rejection when a generation is
		// aborted would go unhandled.
		if (!config.schema) Promise.resolve(output).catch(() => {});

		for await (const event of stream) {
			events.push(event);

			if (event.type === "start-step") {
				yield {
					type: "start",
					warnings: event.warnings,
				};
			}

			const part = ModelTransformService.fromSdkEvent({
				user,
				config,
				provider,
				event,
			});

			if (part) yield part;

			if (event.type === "finish" || event.type === "error") {
				yield {
					type: "end",
					metadata: events,
				};
			}
		}

		if (config.schema) {
			yield {
				type: "data",
				value: {
					id: CommonUtils.getRandomId(),
					type: "json",
					value: await output,
				},
			};
		}
	},

	runEmbeddingModel: async ({
		user,
		provider,
		config,
		env,
		values,
	}: {
		user: zUser;
		provider: ModelProvider<any>;
		config: zConfig;
		env: Partial<zClientEnv>;
		values: string[];
	}) => {
		const sdkModel = provider.getEmbeddingModel({
			user,
			model: config.model,
			env,
		});
		if (!sdkModel)
			throw new Error(`No embedding model available for ${config.model}`);

		// no args used at the moment:
		// config = ModelProviderUtils.getConfigDefaults({ config, args: provider.getModelArgs({ model: config.model }) }));

		return (await embedMany({ model: sdkModel, values })).embeddings;
	},
};
