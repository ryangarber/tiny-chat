import {
	type CursorHost,
	type CursorModelInfo,
	type CursorOptions,
	type CursorProvider as CursorSdk,
	type CursorSubagentProgress,
	createCursor,
} from "@ryangarber/ai-sdk-providers/cursor";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	zData,
	zDataSimplePart,
	zSignature,
} from "#core/features/data/types/part.ts";
import type {
	ModelProvider,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

const NAME = "cursor";
const MODES = ["off", "sandbox", "full-access"] as const;
const SUPPORTED_FILES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const metadataOf = (event: unknown) =>
	(event as { providerMetadata?: Record<string, Record<string, unknown>> })
		?.providerMetadata?.[NAME];

const signatureOf = (event: unknown): zSignature | undefined => {
	const metadata = metadataOf(event);
	if (typeof metadata?.agentId !== "string") return undefined;
	return {
		model: NAME,
		item: metadata.agentId,
		metadata: Object.fromEntries(
			Object.entries(metadata).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
	};
};

const toParts = (output: unknown): zDataSimplePart[] => {
	if (output === undefined || output === null) return [];
	if (typeof output === "object") {
		const value = output as Record<string, unknown>;
		if (value.status === "success") return toParts(value.value);
		if (value.status === "error") return toParts(value.error);
		if (Array.isArray(output)) return output.flatMap(toParts);
		if (Array.isArray(value.content)) return value.content.flatMap(toParts);
		if (value.type === "image" && typeof value.data === "string")
			return [
				{
					id: CommonUtils.getRandomId(),
					type: "file",
					mime:
						typeof value.mimeType === "string" ? value.mimeType : "image/png",
					data: value.data,
				},
			];
		if (typeof value.text === "string") return toParts(value.text);
		if (typeof value.output === "string") return toParts(value.output);
	}
	return [
		{
			id: CommonUtils.getRandomId(),
			type: "text",
			value: typeof output === "string" ? output : JSON.stringify(output),
		},
	];
};

const toData = ({ messages }: CursorSubagentProgress): zData =>
	messages.map((message, index) =>
		message.role === "assistant"
			? toParts(message.text)
			: [
					{
						type: "toolCall",
						id: `cursor-${index}`,
						name: message.toolName,
						input: message.input,
					},
					...(message.output === undefined
						? []
						: [
								{
									type: "toolResult" as const,
									id: `cursor-${index}`,
									name: message.toolName,
									output: toParts(message.output),
									error: message.isError,
								},
							]),
				],
	);

/** Cursor's local agent, with Tiny Chat's tools and an optional native tool set. */
export const createCursorProvider = (
	host: CursorHost | (() => CursorHost | Promise<CursorHost>),
	signIn?: () => Promise<void>,
): ModelProvider<CursorSdk> => {
	const sdk = createCursor({ host });
	let offered: CursorModelInfo[] = [];
	const getModel = (name: string) => offered.find((model) => model.id === name);
	const isNative = (config: { args?: Record<string, unknown> }) =>
		MODES.slice(1).some((mode) => config.args?.["native-mode"] === mode);

	return {
		name: NAME,
		type: "model",
		settings: [],
		keepsContext: true,
		signIn,
		getSdk: () => sdk,
		getLanguageModel: ({ model }) => sdk(model),
		getEmbeddingModel: () => null,
		async getStatus() {
			try {
				const status = await sdk.status();
				if (!status.loggedIn)
					return {
						valid: false,
						error: status.error ?? "Sign in to Cursor to use its models",
						models: [],
					};
				offered = status.models?.length
					? status.models
					: [{ id: "auto-smart" }];
				return {
					valid: true,
					models: offered.map((model) => ({
						name: model.id,
						features: ["language", "language:tools"] as (
							| "language"
							| "language:tools"
						)[],
						args: this.getModelArgs({ model: model.id }),
					})),
				};
			} catch (error) {
				console.error("[CursorProvider] status failed:", error);
				return { valid: false, error: "Failed to reach Cursor", models: [] };
			}
		},
		getModelArgs({ model }) {
			const args: zModelArg[] = ModelProviderUtils.getModelArgs({
				temperature: false,
				tokensOut: false,
			});
			args.push({
				type: "list",
				name: "native-mode",
				values: [...MODES],
				default: "off",
			});
			for (const parameter of getModel(model)?.parameters ?? []) {
				if (!parameter.values.length) continue;
				const preferred = getModel(model)
					?.variants?.find((variant) => variant.isDefault)
					?.params.find((param) => param.id === parameter.id)?.value;
				args.push({
					type: "list",
					name: parameter.id,
					values: parameter.values.map((value) => value.value),
					default:
						parameter.values.find((value) => value.value === preferred)
							?.value ?? parameter.values[0].value,
				});
			}
			return args;
		},
		getSdkOptions({ config, folders }) {
			const { args } = ModelProviderUtils.applyDefaultArgs({
				config: { ...config },
				args: this.getModelArgs({ model: config.model }),
			});
			const native = isNative({ args });
			const [cwd, ...additionalDirectories] = folders ?? [];
			const options: CursorOptions = {
				cwd,
				additionalDirectories,
				// Custom system prompts require account access in Cursor. Keep its
				// base prompt and add Tiny Chat's instructions in either mode.
				systemPromptPreset: "cursor",
				builtinTools: native ? "cursor" : [],
				settingSources: native ? ["all"] : [],
				sandbox: native && args["native-mode"] === "sandbox",
				autoReview: true,
				params: (getModel(config.model)?.parameters ?? []).flatMap(
					(parameter) =>
						parameter.values.some((value) => value.value === args[parameter.id])
							? [{ id: parameter.id, value: args[parameter.id] as string }]
							: [],
				),
			};
			return { [NAME]: JSON.parse(JSON.stringify(options)) };
		},
		runsTools: ({ config }) => isNative(config),
		async getPartTransformed({ part }) {
			if (part.type === "interjection" && part.signature?.model === NAME)
				return [];
			if (part.type !== "file") return undefined;
			return [
				await ModelProviderUtils.getPartTransformed({
					part,
					supportedFileTypes: SUPPORTED_FILES,
				}),
			];
		},
		getPartSignature: ({ event }) => signatureOf(event),
		getPartSignatureReturn: ({ part }) =>
			part.signature?.model === NAME && part.signature.metadata
				? { [NAME]: part.signature.metadata }
				: undefined,
		getEventTransformed({ event }) {
			if (
				(event.type === "tool-result" || event.type === "tool-error") &&
				event.providerExecuted
			) {
				const output =
					event.type === "tool-result" ? event.output : event.error;
				if ((output as CursorSubagentProgress | undefined)?.type === "subagent")
					return [
						{
							type: "toolStream",
							id: event.toolCallId,
							data: toData(output as CursorSubagentProgress),
						},
					];
				return [
					{
						type: "data",
						value: {
							type: "toolResult",
							id: event.toolCallId,
							name: event.toolName,
							providerExecuted: true,
							output: toParts(output),
							error:
								event.type === "tool-error" ||
								(output as { status?: string } | undefined)?.status === "error",
							signature: signatureOf(event),
						},
					},
				];
			}
			if (event.type === "custom" && metadataOf(event)) return [];
			return undefined;
		},
		shouldContinue({ events }) {
			const awaiting = metadataOf(
				events.findLast((event) => event.type === "finish"),
			)?.awaiting;
			return Array.isArray(awaiting) && awaiting.includes("continue");
		},
	};
};
