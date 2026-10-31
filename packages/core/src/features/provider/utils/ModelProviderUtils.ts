import { zConfig } from "#core/features/data/types/message.ts";
import type { zDataPart } from "#core/features/data/types/part.ts";
import { FileExtractionService } from "#core/features/file/services/FileExtractionService.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import type {
	ModelProvider,
	ModelProviderStatus,
	zModel,
	zModelArg,
	zModelFeature,
} from "#core/features/provider/types/model.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import { VERBOSE } from "#core/logger.ts";

type ModelRef = Pick<zConfig, "provider" | "model">;

export const ModelProviderUtils = {
	/** Every model on offer with `feature`, in provider order. */
	getModels: ({
		providers,
		feature,
	}: {
		providers: ProviderState<ProviderStatus>[];
		feature: zModelFeature;
	}): { provider: string; model: zModel }[] =>
		providers
			.filter(
				(provider): provider is ProviderState<ModelProviderStatus> =>
					provider.type === "model" &&
					Array.isArray((provider.status as ModelProviderStatus).models),
			)
			.flatMap((provider) =>
				provider.status.models
					.filter((model) => model.features.includes(feature))
					.map((model) => ({ provider: provider.name, model })),
			),

	/**
	 * The config to chat with: the first of `candidates` naming a language model
	 * still on offer. When none does, the first candidate keeps its tools and
	 * skills but moves to an available model, preferring one that is not hidden.
	 * Null only when no language model is on offer at all.
	 */
	getConfigValid: ({
		candidates,
		providers,
		hidden = [],
	}: {
		candidates: (zConfig | null | undefined)[];
		providers: ProviderState<ProviderStatus>[];
		hidden?: ModelRef[];
	}): zConfig | null => {
		const models = ModelProviderUtils.getModels({
			providers,
			feature: "language",
		});
		const configs = candidates.filter((config): config is zConfig => !!config);
		const valid = configs.find((config) =>
			models.some(
				(m) => m.provider === config.provider && m.model.name === config.model,
			),
		);
		if (valid) return valid;

		const fallback =
			models.find(
				(m) =>
					!hidden.some(
						(h) => h.provider === m.provider && h.model === m.model.name,
					),
			) ?? models[0];
		if (!fallback) return null;
		const [base] = configs;
		return zConfig.parse({
			...base,
			provider: fallback.provider,
			model: fallback.model.name,
			args: ModelProviderUtils.getArgsValid({
				args: base?.args ?? {},
				modelArgs: fallback.model.args,
			}),
		});
	},

	isModel: (model: string, ...groups: string[]) => {
		model = model.replace(/[+_.:]/g, "-");
		groups = groups.map((group) => group.replace(/[+_.:]/g, "-"));
		return groups.some((group) =>
			group
				.split(" ")
				.every((match) =>
					new RegExp(`(?:^|\\W)(${match})(?:\\W|$)`, "i").test(model),
				),
		);
	},

	getModelArgs: ({
		temperature = 2,
		tokensOut = 200_000,
	}: {
		temperature?: number | false;
		tokensOut?: number | false;
	}) => {
		const args: zModelArg[] = [
			{
				type: "range",
				name: "tokens-in",
				min: 1_000,
				max: 2_000_000,
				default: 200_000,
			},
		];

		if (tokensOut) {
			args.push({
				type: "range",
				name: "tokens-out",
				min: 1_000,
				max: tokensOut,
				default: 20_000,
			});
		}

		if (temperature) {
			args.push({
				type: "range",
				name: "temperature",
				min: 0,
				max: temperature,
				default: 1,
			});
		}

		return args;
	},

	/** The subset of `args` that `modelArgs` declares and would accept. */
	getArgsValid: ({
		args,
		modelArgs,
	}: {
		args: Record<string, unknown>;
		modelArgs: zModelArg[];
	}) =>
		Object.fromEntries(
			Object.entries(args).filter(([name, value]) => {
				const arg = modelArgs.find((other) => other.name === name);
				if (arg?.type === "list") {
					return typeof value === "string" && arg.values.includes(value);
				}
				if (arg?.type === "range") {
					return (
						typeof value === "number" && value >= arg.min && value <= arg.max
					);
				}
				if (arg?.type === "toggle") {
					return typeof value === "boolean";
				}
				return false;
			}),
		),

	/**
	 * A part in a form this model can actually take.
	 *
	 * A file the model accepts is passed through untouched — a provider that
	 * reads PDFs natively sees the page as it was laid out, which no conversion
	 * can give back. Anything else has to become text, and a document is a
	 * container: decoding its bytes would send the model the zip header of a
	 * `.docx` rather than the letter inside it, so it goes to the converter
	 * first.
	 */
	getPartTransformed: async ({
		part,
		supportedFileTypes = [],
	}: {
		part: zDataPart;
		supportedFileTypes?: string[];
	}): Promise<zDataPart> => {
		if (part.type === "file") {
			if (!supportedFileTypes.some((m) => part.mime.startsWith(m))) {
				if (FileExtractionService.canExtract(part)) {
					const extracted = await FileExtractionService.extract({
						data: FileUtils.getBufferFromBytes(part),
						name: part.name,
						mime: part.mime,
					});
					if (extracted) return { id: part.id, type: "text", value: extracted };
				}

				const text = FileUtils.getTextFromBytes(part);
				if (text) return { id: part.id, type: "text", value: text };
				return {
					id: part.id,
					type: "text",
					value: `[Unsupported file: ${part.name ?? part.mime}]`,
				};
			}
		}
		return part;
	},

	applyDefaultArgs: ({
		config,
		args,
	}: {
		config: zConfig;
		args: zModelArg[];
	}) => {
		if (VERBOSE) console.log("[ModelProviderUtils] model args:", args);
		if (config.args === undefined) config.args = {};
		const appliedArgs: Record<string, unknown> = {};
		for (const arg of args) {
			appliedArgs[arg.name] = config.args[arg.name] ?? arg.default;
		}
		config.args = appliedArgs;
		console.log(
			`[ModelProviderUtils] applied args (${Object.keys(config.args).filter((name) => !args.find((arg) => arg.name === name)).length} ignored, ${args.filter((arg) => config.args[arg.name] != null).length} defaults)`,
		);
		return config;
	},

	getSignaturePruned: (
		signature: ReturnType<NonNullable<ModelProvider<any>["getPartSignature"]>>,
	) => {
		if (!signature) return undefined;
		for (const [k, v] of Object.entries(signature)) {
			if (k !== "model" && v !== undefined) return signature;
		}
		return undefined;
	},

	getSignatureReturnPruned: (
		signatureReturn: ReturnType<
			NonNullable<ModelProvider<any>["getPartSignatureReturn"]>
		>,
	) => {
		if (!signatureReturn) return undefined;
		const cleaned: Record<string, any> = {};
		for (const [k, p] of Object.entries(signatureReturn)) {
			if (
				Object.entries(p as Record<string, any>).some(
					([_, v]) => v !== undefined,
				)
			)
				cleaned[k] = p;
		}
		return Object.entries(cleaned).length ? cleaned : undefined;
	},
} as const;
