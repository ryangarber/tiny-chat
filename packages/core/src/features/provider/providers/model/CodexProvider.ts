import {
	type CodexHost,
	type CodexOptions,
	type CodexProvider as CodexSdk,
	type CodexStatus,
	type CodexSubagentProgress,
	createCodex,
} from "@ryangarber/ai-sdk-providers/codex";
import type { Tool as SdkTool, TextStreamPart } from "ai";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import type {
	zData,
	zDataSimplePart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";
import type {
	ModelProvider,
	zModel,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";
import {
	AskQuestionUtils,
	ask_question,
	askQuestionDisplay,
} from "#core/features/tool/tools/questions/ask_question.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type { Tool } from "#core/features/tool/types/tool.ts";

const NAME = "codex";
/** What `providerOptions` and metadata are keyed by. */
const KEY = "codex";

export const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

/**
 * How Codex may act with its own tools, as its CLI's presets: what its
 * sandbox lets it touch, and when it asks first.
 */
const CODEX_MODES = {
	"read-only": { sandbox: "read-only", approvalPolicy: "on-request" },
	auto: { sandbox: "workspace-write", approvalPolicy: "on-request" },
	"full-access": { sandbox: "danger-full-access", approvalPolicy: "never" },
} as const satisfies Record<
	string,
	Pick<CodexOptions, "sandbox" | "approvalPolicy">
>;
type CodexMode = keyof typeof CODEX_MODES;
const MODES = Object.keys(CODEX_MODES) as CodexMode[];

/** How much of its reasoning Codex shows, as thoughts. */
const SUMMARIES = ["auto", "concise", "detailed", "none"] as const;

/** The service tier Codex's fast mode is. */
const FAST_TIER = "priority";

/**
 * How the user set Codex up, from the provider's settings. Strings, as every
 * provider setting is.
 */
export interface CodexSettings {
	/** Config above `config.toml`, as a JSON object of dotted keys or tables. */
	config?: string;
}

/** Its settings, in the order they are shown. */
const SETTINGS = ["config"] as const satisfies (keyof CodexSettings)[];

/** What is offered until `codex` says what it offers the account. */
const MODELS: NonNullable<CodexStatus["models"]> = [
	{ value: "default", efforts: [...CODEX_EFFORTS], defaultEffort: "medium" },
];

/** Its own tools that start a subagent, which the user can stop on its own. */
const SUBAGENT_TOOLS = new Set(["spawn_agent"]);

/** The file types Codex reads as they are; others are sent as text. */
const SUPPORTED_FILES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** One of `values` that `value` is, if it is one. */
const pick = <T extends string>(values: readonly T[], value: unknown) =>
	values.find((v) => v === value);

/** A setting holding JSON, or nothing if it is empty or unreadable. */
const parseJson = (value: string | undefined) => {
	if (!value?.trim()) return undefined;
	try {
		return JSON.parse(value) as Record<string, unknown>;
	} catch {
		console.warn("[CodexProvider] config is not valid JSON");
		return undefined;
	}
};

const text = (value: string): zDataSimplePart[] =>
	value ? [{ id: CommonUtils.getRandomId(), type: "text", value }] : [];

/** An image's data URL, as a file part. */
const image = (url: string): zDataSimplePart[] => {
	const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
	return match
		? [
				{
					id: CommonUtils.getRandomId(),
					type: "file",
					mime: match[1],
					data: match[2],
				},
			]
		: text(url);
};

/** What one of Codex's own tools returned, as Tiny Chat's parts. */
const toParts = (output: unknown): zDataSimplePart[] => {
	if (output === undefined || output === null) return [];
	if (typeof output === "string") return text(output);
	// What the caller's tools and MCP servers return: content items.
	if (Array.isArray(output) || Array.isArray((output as any).content)) {
		const items = (
			Array.isArray(output) ? output : (output as any).content
		) as any[];
		return items.flatMap((item): zDataSimplePart[] => {
			if (typeof item?.text === "string") return text(item.text);
			if (typeof item?.imageUrl === "string") return image(item.imageUrl);
			if (item?.type === "image" && typeof item.data === "string")
				return image(
					`data:${item.mimeType ?? "image/png"};base64,${item.data}`,
				);
			return text(JSON.stringify(item));
		});
	}
	const value = output as Record<string, unknown>;
	// A command's output, as the terminal wrote it.
	if (typeof value.output === "string") return text(value.output);
	if (typeof value.error === "string") return text(value.error);
	// A generated image, inline.
	if (typeof value.result === "string" && value.status !== undefined)
		return image(`data:image/png;base64,${value.result}`);
	return text(JSON.stringify(output));
};

/** A subagent's conversation so far, as the steps of a reply. */
const toData = ({ messages }: CodexSubagentProgress): zData => {
	const data: zData = [];
	for (const message of messages) {
		if (message.role === "assistant") {
			data.push(
				message.content.map((part) =>
					part.type === "tool-call"
						? {
								type: "toolCall" as const,
								id: part.toolCallId,
								name: part.toolName,
								input: part.input,
							}
						: {
								id: CommonUtils.getRandomId(),
								type:
									part.type === "text"
										? ("text" as const)
										: ("thought" as const),
								value: part.text,
							},
				),
			);
		} else {
			const step = data.at(-1);
			if (!step) continue;
			for (const result of message.content)
				step.push({
					type: "toolResult",
					id: result.toolCallId,
					name: result.toolName,
					output: toParts(result.output),
					...(result.isError && { error: true }),
				});
		}
	}
	return data;
};

/** What a part keeps of this provider's metadata: where its thread was left. */
const signatureMetadata = (metadata: Record<string, unknown>) => {
	const kept: Record<string, string> = {};
	for (const key of ["threadId", "turnId", "cursor", "fingerprint", "model"])
		if (typeof metadata[key] === "string") kept[key] = metadata[key] as string;
	return kept;
};

/** This provider's metadata on a part or event, if it has any. */
const metadataOf = (event: unknown) =>
	(event as { providerMetadata?: Record<string, Record<string, unknown>> })
		?.providerMetadata?.[KEY];

/**
 * Codex's `request_user_input`, answered as Tiny Chat's own questions are:
 * the user fills in its fields, and Codex reads the answers by question.
 */
const requestUserInput = {
	...ask_question,
	name: "request_user_input",
	display: askQuestionDisplay as ToolDisplay<typeof ask_question>,
	execute: async ({ input, feedback }) => [
		{
			type: "json",
			value: { answers: AskQuestionUtils.getAnswers(input, feedback) },
		},
	],
} as Tool<typeof ask_question, void> as Tool<any, any>;

/**
 * Codex on the user's own ChatGPT plan, through their installed and
 * signed-in `codex`, as a model: one call of its own agent loop at a time,
 * picked up again from its thread with the next. Its own tools and prompt,
 * and Tiny Chat's tools, are each switched on or off; its own run in its
 * sandbox and ask for approval in Tiny Chat. The host runs `codex`: in this
 * process, or another one over a channel.
 */
export const createCodexProvider = (
	host: CodexHost | (() => CodexHost | Promise<CodexHost>),
): ModelProvider<CodexSdk> => {
	const sdk = createCodex({ host });

	/** What `codex` last said it offers, which the models' args follow. */
	let offered: CodexStatus | undefined;

	const getModel = (name: string) =>
		(offered?.models ?? MODELS).find((model) => model.value === name);

	/** Whether a step runs with Codex's own tools and prompt. */
	const isNative = (config: { args?: Record<string, unknown> }) =>
		(config.args?.["native-mode"] ?? "off") !== "off";

	return {
		name: NAME,
		type: "model",
		settings: [...SETTINGS],
		keepsContext: true,

		getSdk: () => sdk,

		getLanguageModel({ model }) {
			return sdk(model);
		},

		getEmbeddingModel() {
			return null;
		},

		async getStatus() {
			let status: CodexStatus;
			try {
				status = await sdk.status();
			} catch (error) {
				console.error("[CodexProvider] status failed:", error);
				return { valid: false, error: "Failed to reach Codex", models: [] };
			}
			if (!status.installed)
				return {
					valid: false,
					error: "Install Codex, then run `codex login` to sign in",
					models: [],
				};
			if (!status.loggedIn)
				return {
					valid: false,
					error: "Run `codex login` and sign in to use Codex",
					models: [],
				};
			offered = status;
			const models = status.models?.length ? status.models : MODELS;
			return {
				valid: true,
				// The account's default first, as Codex picks it.
				models: [...models]
					.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault))
					.map(
						(model): zModel => ({
							name: model.value,
							features: ["language", "language:tools"],
							args: this.getModelArgs({ model: model.value }),
						}),
					),
			};
		},

		/** What can be picked for one of its models, as `codex` says it has. */
		getModelArgs({ model: name }) {
			const model = getModel(name);
			const args: zModelArg[] = ModelProviderUtils.getModelArgs({
				temperature: false,
				tokensOut: false,
			});

			args.push({
				type: "list",
				name: "native-mode",
				values: ["off", ...MODES],
				default: "off",
			});

			const efforts = model?.efforts?.length
				? model.efforts
				: [...CODEX_EFFORTS];
			args.push({
				type: "list",
				name: "effort",
				values: [...efforts],
				default:
					pick(efforts, model?.defaultEffort) ??
					pick(efforts, "medium") ??
					efforts[0],
			});

			args.push({
				type: "list",
				name: "reasoning-summary",
				values: [...SUMMARIES],
				default: "auto",
			});

			if (model?.serviceTiers?.includes(FAST_TIER))
				args.push({ type: "toggle", name: "fast-mode", default: false });

			return args;
		},

		/**
		 * `native-mode` is Tiny Chat's: off, Codex runs bare, with only Tiny
		 * Chat's prompt and tools, unable to write; otherwise with its own
		 * prompt, tools and setup, its sandbox and approvals as the mode says.
		 */
		getSdkOptions({ user, config, context, folders }) {
			const model = getModel(config.model);
			const { args } = ModelProviderUtils.applyDefaultArgs({
				config: { ...config },
				args: this.getModelArgs({ model: config.model }),
			});
			const native = isNative({ args });
			const mode = pick(MODES, args["native-mode"]);
			const settings: CodexSettings | undefined = SettingsUtils.of(
				context?.user ?? user,
				context?.chat?.project,
			).providers?.[NAME];
			const [cwd, ...additionalDirectories] = folders ?? [];

			const options: CodexOptions = {
				cwd,
				additionalDirectories,
				systemPromptPreset: native ? "codex" : null,
				builtinTools: native ? "codex" : [],
				userConfig: native,
				...(native && mode && CODEX_MODES[mode]),
				effort: pick(model?.efforts ?? [...CODEX_EFFORTS], args.effort),
				reasoningSummary: pick(SUMMARIES, args["reasoning-summary"]),
				serviceTier:
					model?.serviceTiers?.includes(FAST_TIER) && args["fast-mode"] === true
						? FAST_TIER
						: undefined,
				config: parseJson(settings?.config),
			};
			return { [KEY]: JSON.parse(JSON.stringify(options)) };
		},

		getSdkTools({ config }): Record<string, SdkTool> {
			return isNative(config)
				? { request_user_input: sdk.tools.requestUserInput({}) }
				: {};
		},

		/** Natively, its own tools run without Tiny Chat. */
		runsTools({ config }) {
			return isNative(config);
		},

		getTools({ config }) {
			return isNative(config) ? [requestUserInput] : [];
		},

		async getPartTransformed({ part }) {
			// What Codex told Tiny Chat, it already knows.
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

		getPartSignature({ event }) {
			const metadata = metadataOf(event);
			if (typeof metadata?.threadId !== "string") return undefined;
			return {
				model: NAME,
				item: metadata.threadId,
				metadata: signatureMetadata(metadata),
			};
		},

		getPartSignatureReturn({ part }) {
			if (part.signature?.model !== NAME || !part.signature.metadata)
				return undefined;
			return { [KEY]: part.signature.metadata };
		},

		getEventTransformed({ event }) {
			return readEvent(event);
		},

		shouldContinue({ events }) {
			const finish = events.findLast((event) => event.type === "finish");
			const awaiting = metadataOf(finish)?.awaiting;
			// Its subagents report in as they go, after the turn has ended.
			return Array.isArray(awaiting) && awaiting.includes("background");
		},

		async stopToolCall({ part }) {
			const thread = part.signature?.item;
			if (thread && SUBAGENT_TOOLS.has(part.name))
				await sdk.stopTask(thread, part.id);
		},
	};
};

/** Codex's own events, as Tiny Chat's; undefined for any other. */
const readEvent = (event: TextStreamPart<any>): zAgentEvent[] | undefined => {
	const metadata = metadataOf(event);
	const signature =
		typeof metadata?.threadId === "string"
			? {
					model: NAME,
					item: metadata.threadId,
					metadata: signatureMetadata(metadata),
				}
			: undefined;

	if (event.type === "tool-approval-request")
		return [{ type: "approval", id: event.toolCall.toolCallId }];

	if (
		(event.type === "tool-result" || event.type === "tool-error") &&
		event.providerExecuted
	) {
		const output = event.type === "tool-result" ? event.output : event.error;
		// A subagent's work so far, shown inside its spawn call while it runs.
		// `ai` doesn't always keep a provider's result `preliminary`: its shape
		// tells instead.
		const progress = output as CodexSubagentProgress | undefined;
		if (progress?.type === "subagent")
			return [
				{ type: "toolStream", id: event.toolCallId, data: toData(progress) },
			];
		const result: zToolResultPart = {
			type: "toolResult",
			id: event.toolCallId,
			name: event.toolName,
			providerExecuted: true,
			output: toParts(output),
			...(event.type === "tool-error" && { error: true }),
			signature,
		};
		return [{ type: "data", value: result }];
	}

	// Its plan, diffs and compactions are Codex's own business.
	if (event.type === "custom") return [];

	return undefined;
};
