import {
	type AfmizeClient,
	type AfmModelId,
	type AfmProvider,
	createAfmProvider,
} from "@ryangarber/ai-sdk-providers/afm";
import type {
	ModelProvider,
	zModel,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

/**
 * Apple Foundation Models through `@ryangarber/ai-sdk-providers`, for any
 * host with an afmize client: `@afmize/node`'s in the CLI and the desktop
 * app's main process, `@afmize/capacitor`'s on iOS, or one over IPC to either.
 */
export const createAFMProvider = (
	afmize: AfmizeClient,
): ModelProvider<AfmProvider> => {
	const sdk = createAfmProvider({ afmize });

	return {
		name: "apple",
		type: "model",
		settings: [],

		getSdk: () => sdk,

		getSdkOptions() {
			return {};
		},

		getLanguageModel({ model }) {
			return sdk.languageModel(model as AfmModelId);
		},

		getEmbeddingModel() {
			return null;
		},

		async getStatus() {
			const report = await sdk.availability();

			const models: zModel[] = [];

			if (report.onDevice.available) {
				models.push({
					name: "on-device",
					features: ["language", "language:tools"],
					args: this.getModelArgs({ model: "on-device" }),
				});
			}

			// Private Cloud Compute stays off until the apps support it, whatever
			// afmize reports.

			return { valid: true, models };
		},

		getModelArgs({ model }) {
			const args: zModelArg[] = ModelProviderUtils.getModelArgs({});

			if (model === "private-cloud-compute") {
				args.push({
					name: "reasoning",
					type: "list",
					values: ["light", "moderate", "deep"],
					default: "moderate",
				});
			}

			return args;
		},
	};
};
