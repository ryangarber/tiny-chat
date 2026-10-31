import {
	type WebLLMProvider as _WebLLMProvider,
	createWebLLM,
} from "@browser-ai/web-llm";
import type { AppConfig } from "@mlc-ai/web-llm";
import { ModelType, prebuiltAppConfig } from "@mlc-ai/web-llm";
import type {
	ModelProvider,
	zModel,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

const WebLLMConfig: AppConfig = {
	...prebuiltAppConfig,
	model_list: prebuiltAppConfig.model_list.map((model) => ({
		...model,
		overrides: {
			...model.overrides,
			context_window_size: 16384,
		},
	})),
};

export const WebLLMProvider: ModelProvider<_WebLLMProvider> = {
	name: "native",
	type: "model",
	settings: [],

	getSdk() {
		return createWebLLM();
	},

	getSdkOptions() {
		return {};
	},

	async getStatus() {
		return {
			valid: true,
			models: (WebLLMConfig.model_list.map(({ model_id, model_type }) => ({
				name: model_id,
				features:
					model_type === ModelType.embedding
						? ["embedding"]
						: ["language", "language:tools"],
				args: this.getModelArgs({ model: model_id }),
			})) ?? []) satisfies zModel[],
		};
	},

	getModelArgs() {
		return ModelProviderUtils.getModelArgs({ temperature: 2 });
	},

	getLanguageModel({ user, model, env }) {
		return (
			this.getSdk({ user, model, env })?.languageModel(model, {
				appConfig: WebLLMConfig,
				engineConfig: {
					initProgressCallback: console.log,
					appConfig: WebLLMConfig,
				},
			}) ?? null
		);
	},

	getEmbeddingModel({ user, model, env }) {
		return (
			this.getSdk({ user, model, env })?.embeddingModel(model, {
				appConfig: WebLLMConfig,
				engineConfig: {
					initProgressCallback: console.log,
					appConfig: WebLLMConfig,
				},
			}) ?? null
		);
	},
};
