import { createAfmize } from "@afmize/node";
import { createAFMProvider } from "#core/features/provider/providers/model/AFMProvider.ts";
import type { ModelProvider } from "#core/features/provider/types/model.ts";

let provider: ModelProvider<any> | undefined;

export const AFMService = {
	/**
	 * Apple Foundation Models through `@afmize/node`, whose library the
	 * compiled binary embeds; only on macOS on Apple silicon, the one place
	 * it runs. (On a macOS too old for FoundationModels, it reports no models.)
	 */
	getProviders: (): ModelProvider<any>[] => {
		if (process.platform !== "darwin" || process.arch !== "arm64") return [];
		provider ??= createAFMProvider(createAfmize());
		return [provider];
	},
} as const;
