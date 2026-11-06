import {
	type ClaudeCodeHost,
	type ClaudeCodeOptions,
	type ClaudeCodeProvider as ClaudeCodeSdk,
	type ClaudeCodeStatus,
	type ClaudeCodeSubagentProgress,
	type ClaudeCodeToolOutput,
	createClaudeCode,
} from "@ryangarber/ai-sdk-providers/claude";
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
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";

const NAME = "claude-code";
/** What `providerOptions` and metadata are keyed by. */
const KEY = "claudeCode";

export const CLAUDE_CODE_EFFORTS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

/** Claude Code's own permission modes. */
export const CLAUDE_CODE_PERMISSION_MODES = [
	"default",
	"acceptEdits",
	"plan",
	"auto",
	"dontAsk",
	"bypassPermissions",
] as const;

/**
 * How the user set Claude Code up, from the provider's settings. Strings, as
 * every provider setting is.
 */
export interface ClaudeCodeSettings {
	/** The `claude` to run, in place of the one found on the login shell's path. */
	executable?: string;
	/**
	 * Settings above all of those files, as Claude Code's `settings.json` takes
	 * them: a JSON object, or the path of a file holding one.
	 */
	settings?: string;
}

/** Its settings, in the order they are shown. */
const SETTINGS = [
	"executable",
	"settings",
] as const satisfies (keyof ClaudeCodeSettings)[];

/**
 * Claude Code's model aliases, which follow its newest models: offered until
 * `claude` says what it offers the account.
 */
const MODELS: NonNullable<ClaudeCodeStatus["models"]> = [
	"haiku",
	"sonnet",
	"opus",
].map((value) => ({ value, efforts: [...CLAUDE_CODE_EFFORTS] }));

/** Its own tools that start a subagent, which the user can stop on its own. */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** The file types Claude reads as they are; others are sent as text. */
const SUPPORTED_FILES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
];

/** One of `values` that `value` is, if it is one. */
const pick = <T extends string>(values: readonly T[], value: unknown) =>
	values.find((v) => v === value);

/** A setting holding JSON, or nothing if it is empty or unreadable. */
const parseJson = (value: string) => {
	try {
		return JSON.parse(value) as Record<string, unknown>;
	} catch {
		console.warn("[ClaudeCodeProvider] settings are not valid JSON");
		return undefined;
	}
};

/** What one of Claude Code's own tools returned, as Tiny Chat's parts. */
const toParts = (output: unknown): zDataSimplePart[] => {
	const id = () => CommonUtils.getRandomId();
	if (typeof output === "string")
		return output ? [{ id: id(), type: "text", value: output }] : [];
	if (!Array.isArray(output)) return [];
	return (output as Exclude<ClaudeCodeToolOutput, string>).flatMap(
		(block): zDataSimplePart[] => {
			if (block.type === "text")
				return [{ id: id(), type: "text", value: block.text }];
			return [
				{
					id: id(),
					type: "file",
					mime: block.mediaType,
					data: block.data,
					...(block.type === "document" &&
						block.title && { name: block.title }),
				},
			];
		},
	);
};

/** A subagent's conversation so far, as the steps of a reply. */
const toData = ({ messages }: ClaudeCodeSubagentProgress): zData => {
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

/** What a part keeps of this provider's metadata: where its session was left. */
const signatureMetadata = (metadata: Record<string, unknown>) => {
	const kept: Record<string, string> = {};
	for (const key of ["sessionId", "cursor"])
		if (typeof metadata[key] === "string") kept[key] = metadata[key] as string;
	return kept;
};

/** This provider's metadata on a part or event, if it has any. */
const metadataOf = (event: unknown) =>
	(event as { providerMetadata?: Record<string, Record<string, unknown>> })
		?.providerMetadata?.[KEY];

/**
 * Claude Code's `AskUserQuestion`, answered as Tiny Chat's own questions are:
 * the user fills in its fields, and Claude Code reads the answers.
 */
const askUserQuestion = {
	...ask_question,
	name: "AskUserQuestion",
	display: askQuestionDisplay as ToolDisplay<typeof ask_question>,
	execute: async ({ input, feedback }) => [
		{
			type: "json",
			value: { answers: AskQuestionUtils.getAnswers(input, feedback) },
		},
	],
} as Tool<typeof ask_question, void> as Tool<any, any>;

/**
 * Claude Code on the user's own subscription, through their installed and
 * signed-in `claude`, as a model: one step of its own agent loop at a time,
 * picked up again from its session with the next. Its own tools and prompt,
 * and Tiny Chat's tools over MCP, are each switched on or off; its own run
 * through its permission flow, answered in Tiny Chat. The host runs `claude`:
 * in this process, or another one over a channel.
 */
export const createClaudeCodeProvider = (
	host: ClaudeCodeHost | (() => ClaudeCodeHost | Promise<ClaudeCodeHost>),
): ModelProvider<ClaudeCodeSdk> => {
	const sdk = createClaudeCode({ host });

	/** What `claude` last said it offers, which the models' args follow. */
	let offered: ClaudeCodeStatus | undefined;

	const getModel = (name: string) =>
		(offered?.models ?? MODELS).find((model) => model.value === name);

	/** Whether a step runs with Claude Code's own tools and prompt. */
	const isNative = (config: {
		model: string;
		args?: Record<string, unknown>;
	}) => (config.args?.["native-mode"] ?? "off") !== "off";

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

		async getStatus({ user }) {
			const settings: ClaudeCodeSettings | undefined =
				user?.settings?.providers?.[NAME];
			let status: ClaudeCodeStatus;
			try {
				status = await sdk.status({ executable: settings?.executable });
			} catch (error) {
				console.error("[ClaudeCodeProvider] status failed:", error);
				return {
					valid: false,
					error: "Failed to reach Claude Code",
					models: [],
				};
			}
			if (!status.installed)
				return {
					valid: false,
					error: "Install Claude Code, then run `claude` to sign in",
					models: [],
				};
			if (!status.loggedIn)
				return {
					valid: false,
					error: "Run `claude` and sign in to use Claude Code",
					models: [],
				};
			offered = status;
			return {
				valid: true,
				models: (status.models?.length ? status.models : MODELS).map(
					(model): zModel => ({
						name: model.value,
						features: ["language", "language:tools"],
						args: this.getModelArgs({ model: model.value }),
					}),
				),
			};
		},

		/**
		 * What can be picked for one of its models, as far as `claude` has said
		 * what the model and the account support.
		 */
		getModelArgs({ model: name }) {
			const model = getModel(name);
			const args: zModelArg[] = ModelProviderUtils.getModelArgs({
				temperature: false,
				tokensOut: false,
			});

			args.push({
				type: "list",
				name: "native-mode",
				values: [
					"off",
					...CLAUDE_CODE_PERMISSION_MODES.filter(
						(mode) => mode !== "auto" || model?.autoMode !== false,
					),
				],
				default: "off",
			});

			const thinking =
				model?.adaptiveThinking === false ? "enabled" : "adaptive";
			args.push({
				type: "list",
				name: "thinking",
				values: [thinking, "disabled"],
				default: thinking,
			});

			const efforts = model?.efforts ?? [];
			if (efforts.length)
				args.push({
					type: "list",
					name: "effort",
					values: [...efforts],
					default: pick(efforts, "medium") ?? efforts[0],
				});

			if (model?.fastMode)
				args.push({ type: "toggle", name: "fast-mode", default: false });

			return args;
		},

		/**
		 * `native-mode` is Tiny Chat's: off, Claude Code runs bare, with only
		 * Tiny Chat's prompt and tools; on, with its own prompt, tools and setup,
		 * its tools asking for approval as the mode says.
		 */
		getSdkOptions({ user, config, context, folders }) {
			const model = getModel(config.model);
			const { args } = ModelProviderUtils.applyDefaultArgs({
				config: { ...config },
				args: this.getModelArgs({ model: config.model }),
			});
			const native = isNative({ model: config.model, args });
			const settings: ClaudeCodeSettings | undefined = SettingsUtils.of(
				context?.user ?? user,
				context?.chat?.project,
			).providers?.[NAME];

			// A settings file is read by Claude Code itself, which can't merge it.
			const file = settings?.settings?.trim();
			const flags: Record<string, unknown> = {
				...(file?.startsWith("{") ? parseJson(file) : undefined),
				// Without its own setup, it brings none of the user's connectors.
				...(!native && { disableClaudeAiConnectors: true }),
			};
			const [cwd, ...additionalDirectories] = folders ?? [];

			const options: ClaudeCodeOptions = {
				executable: settings?.executable?.trim() || undefined,
				cwd,
				additionalDirectories,
				systemPromptPreset: native ? "claude_code" : null,
				builtinTools: native ? "claude_code" : [],
				settingSources: native ? ["user", "project", "local"] : [],
				strictMcpConfig: native ? undefined : true,
				permissionMode: native
					? pick(CLAUDE_CODE_PERMISSION_MODES, args["native-mode"])
					: undefined,
				effort: pick(model?.efforts ?? [], args.effort),
				thinking:
					args.thinking === "disabled"
						? { type: "disabled" }
						: {
								type: args.thinking === "enabled" ? "enabled" : "adaptive",
								display: "summarized",
							},
				fastMode: model?.fastMode ? args["fast-mode"] === true : undefined,
				settings: file && !file.startsWith("{") ? file : flags,
			};
			return { [KEY]: JSON.parse(JSON.stringify(options)) };
		},

		getSdkTools({ config }): Record<string, SdkTool> {
			return isNative(config)
				? { AskUserQuestion: sdk.tools.askUserQuestion({}) }
				: {};
		},

		/** Natively, its own tools run without Tiny Chat. */
		runsTools({ config }) {
			return isNative(config);
		},

		getTools({ config }) {
			return isNative(config) ? [askUserQuestion] : [];
		},

		async getPartTransformed({ part }) {
			// What Claude Code told Tiny Chat, it already knows.
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
			if (typeof metadata?.sessionId !== "string") return undefined;
			return {
				model: NAME,
				item: metadata.sessionId,
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
			// Its work in the background reports in as a turn of its own.
			return Array.isArray(awaiting) && awaiting.includes("background");
		},

		async stopToolCall({ part }) {
			const session = part.signature?.item;
			if (session && SUBAGENT_TOOLS.has(part.name))
				await sdk.stopTask(session, part.id);
		},
	};
};

/** Claude Code's own events, as Tiny Chat's; undefined for any other. */
const readEvent = (event: TextStreamPart<any>): zAgentEvent[] | undefined => {
	const metadata = metadataOf(event);
	const signature =
		typeof metadata?.sessionId === "string"
			? {
					model: NAME,
					item: metadata.sessionId,
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
		// A subagent's work so far, shown inside its call while it runs.
		if (event.type === "tool-result" && event.preliminary) {
			const progress = output as ClaudeCodeSubagentProgress | undefined;
			return progress?.type === "subagent"
				? [{ type: "toolStream", id: event.toolCallId, data: toData(progress) }]
				: [];
		}
		const result: zToolResultPart = {
			type: "toolResult",
			id: event.toolCallId,
			name: event.toolName,
			providerExecuted: true,
			// Still running: its answer comes once it ends, as a notification.
			output: metadata?.background
				? ToolCallUtils.getBackground({ id: event.toolCallId })
				: toParts(output),
			...(event.type === "tool-error" && { error: true }),
			signature,
		};
		return [{ type: "data", value: result }];
	}

	if (event.type === "custom") {
		// Work in the background ended, as Tiny Chat's own background calls do.
		if (event.kind === "claude-code.task-notification" && metadata?.toolCallId)
			return [
				{
					type: "data",
					value: {
						id: CommonUtils.getRandomId(),
						type: "interjection",
						task: {
							id: String(metadata.toolCallId),
							name: "Agent",
							error: metadata.status !== "completed" || undefined,
						},
						value: [
							{
								id: CommonUtils.getRandomId(),
								type: "text",
								value: String(metadata.summary ?? ""),
							},
						],
						signature: { model: NAME },
					},
				},
			];
		return [];
	}

	return undefined;
};
