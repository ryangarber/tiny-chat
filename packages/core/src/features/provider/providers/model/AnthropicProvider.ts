import type {
	AnthropicProvider as _AnthropicProvider,
	AnthropicLanguageModelOptions,
} from "@ai-sdk/anthropic";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Anthropic } from "@anthropic-ai/sdk";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	ModelProvider,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

export const AnthropicProvider: ModelProvider<_AnthropicProvider> = {
	name: "anthropic",
	type: "model",
	settings: ["apiKey"],

	getSdk({ user }) {
		if (!user?.settings?.providers?.anthropic?.apiKey) return null;
		return createAnthropic({
			apiKey: user.settings.providers.anthropic.apiKey as string,
			headers: { "anthropic-dangerous-direct-browser-access": "true" },
		});
	},

	getSdkOptions({ config }) {
		return {
			anthropic: {
				thinking:
					config.args?.thinking === "adaptive" ||
					config.args?.thinking === "disabled"
						? {
								type: config.args.thinking,
								display: "summarized",
								blockBinding: { prefixMismatchBehavior: "drop_block" },
							}
						: config.args?.thinking
							? {
									type: "enabled",
									budgetTokens: parseInt(config.args.thinking as string, 10),
								}
							: undefined,
				effort: config.args?.effort,
				cacheControl: { type: "ephemeral", ttl: "5m" },
			} satisfies AnthropicLanguageModelOptions,
		};
	},

	async getStatus({ user }) {
		try {
			const apiKey = user?.settings?.providers?.anthropic?.apiKey;
			if (!apiKey) return { valid: false, models: [] };

			const client = new Anthropic({
				apiKey: apiKey as string,
				dangerouslyAllowBrowser: true,
			});

			const models = await client.models.list();

			return {
				valid: true,
				models: models.data.map(({ id }) => ({
					name: id,
					features: ["language", "language:tools"],
					args: this.getModelArgs({ model: id }),
				})),
			};
		} catch (error) {
			return {
				valid: false,
				error: CommonUtils.formatError({ error }),
				models: [],
			};
		}
	},

	getModelArgs({ model }) {
		const args: zModelArg[] = [];
		if (ModelProviderUtils.isModel(model, "claude")) {
			args.push(...ModelProviderUtils.getModelArgs({ temperature: false }));
			if (ModelProviderUtils.isModel(model, "4.5")) {
				args.push({
					name: "thinking",
					type: "list" as const,
					values: ["disabled", "2500", "5000", "7500", "10000"],
					default: "2500",
				});
			} else if (ModelProviderUtils.isModel(model, "4.6", "4.7", "4.8", "5")) {
				args.push({
					name: "thinking",
					type: "list" as const,
					values: ["disabled", "adaptive"],
					default: "adaptive",
				});
			}
			if (
				ModelProviderUtils.isModel(model, "opus 4.5", "sonnet 4.6", "opus 4.6")
			) {
				args.push({
					name: "effort",
					type: "list" as const,
					values: ["low", "medium", "high", "max"],
					default: "medium",
				});
			} else if (
				ModelProviderUtils.isModel(model, "opus 4.7", "opus 4.8", "5")
			) {
				args.push({
					name: "effort",
					type: "list" as const,
					values: ["low", "medium", "high", "xhigh", "max"],
					default: "medium",
				});
			}
		}
		return args;
	},

	getLanguageModel({ user, model, env }) {
		return this.getSdk({ user, model, env })?.languageModel(model) ?? null;
	},

	getEmbeddingModel() {
		return null;
	},

	async getPartTransformed({ part }) {
		return [
			await ModelProviderUtils.getPartTransformed({
				part,
				supportedFileTypes: ["image/", "application/pdf"],
			}),
		];
	},

	getPartSignature({ config, event }) {
		if ("providerMetadata" in event) {
			return {
				model: config.model,
				reasoning: event.providerMetadata?.anthropic?.signature as any,
			};
		}
	},

	getPartSignatureReturn({ config, part }) {
		if ("signature" in part) {
			return {
				anthropic: {
					signature:
						part.signature?.model === config.model
							? part.signature?.reasoning
							: undefined,
				},
			};
		}
	},
};
