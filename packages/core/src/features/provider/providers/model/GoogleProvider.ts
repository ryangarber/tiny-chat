import {
	createGoogle,
	type GoogleGenerativeAIProvider,
	type GoogleLanguageModelOptions,
} from "@ai-sdk/google";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zDataPart } from "#core/features/data/types/part.ts";
import type {
	ModelProvider,
	zModel,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

export const GoogleProvider: ModelProvider<GoogleGenerativeAIProvider> = {
	name: "google",
	type: "model",

	settings: ["apiKey"],

	getSdk({ user }) {
		if (!user?.settings?.providers?.google?.apiKey) return null;
		return createGoogle({
			apiKey: user.settings.providers.google.apiKey as string,
		});
	},

	getSdkOptions({ config }) {
		return {
			google: {
				thinkingConfig:
					config.args?.thinking ||
					(config.args?.["thinking-budget"] &&
						config.args["thinking-budget"] !== "auto")
						? {
								includeThoughts: true,
								thinkingLevel: config.args?.thinking,
								thinkingBudget:
									config.args?.["thinking-budget"] &&
									config.args["thinking-budget"] !== "auto"
										? parseInt(config.args["thinking-budget"] as string, 10)
										: undefined,
							}
						: undefined,
				responseModalities: ModelProviderUtils.isModel(config.model, "gemini 3")
					? ["TEXT", "IMAGE"]
					: undefined,
			} satisfies GoogleLanguageModelOptions,
		};
	},

	async getStatus({ user }) {
		if (!user?.settings?.providers?.google?.apiKey)
			return { valid: false, models: [] };

		try {
			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
					user.settings.providers.google.apiKey as string,
				)}`,
			);

			const json = (await response.json()) as {
				models: { name: string; supportedGenerationMethods: string[] }[];
			};

			return {
				valid: true,
				models: json.models.flatMap(({ name, supportedGenerationMethods }) => {
					name = name.split("/").slice(-1)[0];

					if (supportedGenerationMethods.includes("generateContent")) {
						return {
							name,
							features: ["language", "language:tools"],
							args: this.getModelArgs({ model: name }),
						} satisfies zModel;
					}

					if (supportedGenerationMethods.includes("embedContent")) {
						return {
							name,
							features: ["embedding"],
							args: this.getModelArgs({ model: name }),
						} satisfies zModel;
					}

					return [];
				}),
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
		if (ModelProviderUtils.isModel(model, "gemini")) {
			args.push(...ModelProviderUtils.getModelArgs({ temperature: 2 }));
			if (ModelProviderUtils.isModel(model, "gemini 2.5")) {
				args.push({
					name: "thinking-budget",
					type: "list",
					values: ["auto", "0", "2500", "5000", "7500", "10000"],
					default: "auto",
				});
			}
			if (ModelProviderUtils.isModel(model, "gemini 3")) {
				args.push({
					name: "thinking",
					type: "list",
					values: ["minimal", "low", "medium", "high"],
					default: "medium",
				});
			}
		}
		return args;
	},

	getLanguageModel({ user, model, env }) {
		return this.getSdk({ user, model, env })?.languageModel(model) ?? null;
	},

	getEmbeddingModel({ user, model, env }) {
		return this.getSdk({ user, model, env })?.embeddingModel(model) ?? null;
	},

	async getPartTransformed({ config, part }) {
		const parts: zDataPart[] = [];

		if (
			ModelProviderUtils.isModel(config.model, "gemini") &&
			part.type === "text"
		) {
			const youtubeRegex =
				/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([A-Za-z0-9-_]{11})\S*/g;
			let lastIndex = 0;
			let match: RegExpMatchArray | null;

			while (true) {
				match = youtubeRegex.exec(part.value);
				if (!match) break;
				const textBefore = part.value.substring(lastIndex, match.index);
				if (textBefore.length) {
					parts.push({ ...part, value: textBefore });
				}
				parts.push({
					id: CommonUtils.getRandomId(),
					type: "file",
					data: `https://www.youtube.com/watch?v=${match[1]}`,
					mime: "video/mp4",
				});
				lastIndex = youtubeRegex.lastIndex;
			}

			const textAfter = part.value.substring(lastIndex);
			if (textAfter.length) {
				parts.push({ ...part, value: textAfter });
			}
		} else {
			parts.push(part);
		}

		return await Promise.all(
			parts.map((part) =>
				ModelProviderUtils.getPartTransformed({
					part,
					supportedFileTypes: ["video/", "image/", "application/pdf"],
				}),
			),
		);
	},

	getPartSignature({ config, event }) {
		if ("providerMetadata" in event) {
			return {
				model: config.model,
				reasoning: event.providerMetadata?.google?.thoughtSignature as any,
			};
		}
	},

	getPartSignatureReturn({ config, part }) {
		if ("signature" in part) {
			return {
				google: {
					thoughtSignature:
						(part.signature?.model === config.model
							? part.signature.reasoning
							: undefined) ?? "skip_thought_signature_validator",
				},
			};
		}
	},
};
