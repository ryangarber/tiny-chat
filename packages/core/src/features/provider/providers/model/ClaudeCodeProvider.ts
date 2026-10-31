import type { ProviderV4 } from "@ai-sdk/provider";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import type {
	zFileChanges,
	zInterjectionPart,
	zToolCallPart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";
import {
	CLAUDE_CODE_EFFORTS,
	CLAUDE_CODE_PERMISSION_MODES,
	type ClaudeCodeBridge,
	type ClaudeCodeEvent,
	type ClaudeCodeHandlers,
	type ClaudeCodeModel,
	type ClaudeCodeRequest,
	type ClaudeCodeSettings,
	type ClaudeCodeStatus,
	type ClaudeCodeThinkingConfig,
} from "#core/features/provider/types/claude.ts";
import type {
	ModelProvider,
	zModel,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ClaudeCodeUtils } from "#core/features/provider/utils/ClaudeCodeUtils.ts";
import { AskQuestionUtils } from "#core/features/tool/tools/questions/ask_question.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";
import { ModelProviderUtils } from "../../utils/ModelProviderUtils.ts";

const NAME = "claude-code";

/**
 * Claude Code's model aliases, which follow its newest models: offered until
 * `claude` says what it offers the account.
 */
const MODELS: ClaudeCodeModel[] = ["haiku", "sonnet", "opus"].map((value) => ({
	value,
	efforts: [...CLAUDE_CODE_EFFORTS],
}));

/** Its settings, in the order they are shown. */
const SETTINGS = [
	"executable",
	"settings",
] as const satisfies (keyof ClaudeCodeSettings)[];

/** Its own tools that start a subagent, which the user can stop on its own. */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** How often a run checks for messages the user queued. */
const QUEUE_MS = 1000;

/** One of `values` that `value` is, if it is one. */
const pick = <T extends string>(values: readonly T[], value: unknown) =>
	values.find((v) => v === value);

/** Pulls a run's events in order, as a host pushes them. */
const createQueue = <T>() => {
	const items: T[] = [];
	let wake: (() => void) | undefined;
	return {
		push: (item: T) => {
			items.push(item);
			wake?.();
		},
		next: async (): Promise<T> => {
			while (!items.length) await new Promise<void>((r) => (wake = r));
			wake = undefined;
			return items.shift() as T;
		},
	};
};

/**
 * Claude Code on the user's own subscription, through their installed and
 * signed-in `claude`, running its own agent loop. Its own tools and prompt and
 * Tiny Chat's, over MCP, are each switched on or off: its own go through its
 * permission flow in the mode picked, Tiny Chat's through Tiny Chat's. The
 * host supplies only the {@link ClaudeCodeBridge}.
 */
export const createClaudeCodeProvider = (
	bridge: ClaudeCodeBridge,
): ModelProvider<ProviderV4> => {
	/** What `claude` last said it offers, which the models' args follow. */
	let offered: ClaudeCodeStatus | undefined;

	const getModel = (name: string) =>
		(offered?.models ?? MODELS).find((model) => model.value === name);

	return {
		name: NAME,
		type: "model",
		settings: [...SETTINGS],

		getSdk() {
			return null;
		},

		getSdkOptions() {
			return {};
		},

		getLanguageModel() {
			return null;
		},

		getEmbeddingModel() {
			return null;
		},

		async getStatus({ user }) {
			let status: Awaited<ReturnType<ClaudeCodeBridge["status"]>>;
			const settings: ClaudeCodeSettings | undefined =
				user?.settings?.providers?.[NAME];
			try {
				status = await bridge.status({ executable: settings?.executable });
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
				args.push({
					type: "toggle",
					name: "fast-mode",
					default: false,
				});

			return args;
		},

		async *runAgent({
			context,
			config,
			messages,
			system,
			tools,
			folders,
			executeTool,
			approve,
			answer,
			stream,
			signal,
			interjections,
			abortSignal,
		}) {
			const resume = ClaudeCodeUtils.getSession(messages);

			const model = getModel(config.model);
			const { args } = ModelProviderUtils.applyDefaultArgs({
				config: { ...config },
				args: this.getModelArgs({ model: config.model }),
			});

			const request: ClaudeCodeRequest = {
				model: config.model,
				effort: pick(model?.efforts ?? [], args.effort),
				thinking:
					args.thinking === "disabled"
						? { type: args.thinking }
						: ({
								type: args.thinking as "adaptive" | "enabled",
								display: "summarized",
							} satisfies ClaudeCodeThinkingConfig),
				claudeCode: args["native-mode"] !== "off",
				permissions:
					pick(CLAUDE_CODE_PERMISSION_MODES, args["native-mode"]) ?? "default",
				fastMode: model?.fastMode ? args["fast-mode"] === true : undefined,
				schema: config.schema ?? undefined,
				settings: SettingsUtils.of(context.user, context.chat?.project)
					.providers?.[NAME],
				system,
				prompt: await ClaudeCodeUtils.getPrompt(messages),
				resume,
				history: ClaudeCodeUtils.getHistory(messages),
				folders,
				tools: tools.map((tool) => {
					const { inputSchema } = ToolUtils.getPromptDefinition(tool);
					return {
						name: tool.name,
						description: tool.description,
						inputSchema,
					};
				}),
			};

			const reader = ClaudeCodeUtils.createReader({
				onSubagent: (id, data) => {
					const part = reader.getCall(id);
					if (part) stream?.(part, data);
				},
			});

			const queue = createQueue<
				| ClaudeCodeEvent
				/** A call now asks the user something: shown again, so it says so. */
				| { type: "refresh"; id: string }
				/** Tiny Chat answered one of its own calls. */
				| { type: "answered"; result: zToolResultPart }
				/** A message the user queued, now sent to the session. */
				| { type: "interjection"; part: zInterjectionPart }
			>();

			/** Asks the user for what one of Claude Code's own calls needs. */
			const ask = async (
				part: zToolCallPart,
			): Promise<Awaited<ReturnType<ClaudeCodeHandlers["canUseTool"]>>> => {
				if (part.name === "AskUserQuestion") {
					queue.push({ type: "refresh", id: part.id });
					const feedback = await answer(part);
					if (!feedback)
						return { allow: false, message: "The user did not answer." };
					// Replaced whole, so the call shows its answers.
					part.input = {
						...part.input,
						answers: AskQuestionUtils.getAnswers(part.input, feedback),
					};
					queue.push({ type: "refresh", id: part.id });
					return { allow: true, updatedInput: part.input };
				}

				part.validation = { ...part.validation, approval: true };
				queue.push({ type: "refresh", id: part.id });

				return (await approve(part))
					? { allow: true }
					: { allow: false, message: "The user rejected this tool call." };
			};

			/** Stops a subagent on its own once the user stops its call. */
			const watch = (part: zToolCallPart) => {
				if (!SUBAGENT_TOOLS.has(part.name)) return;
				signal?.(part)?.addEventListener(
					"abort",
					() => void bridge.stopTask(id, part.id),
					{ once: true },
				);
			};

			/** What Claude Code's own calls changed, and their results, by call. */
			const changes = new Map<string, zFileChanges>();
			const results = new Map<string, zToolResultPart>();

			const id = await bridge.run(request, {
				onEvent: queue.push,

				async callTool({ name, input, toolUseId }) {
					const part = (toolUseId && reader.getCall(toolUseId)) || {
						type: "toolCall" as const,
						id: toolUseId ?? crypto.randomUUID(),
						name,
						input,
					};
					reader.answer(part.id);

					const result = await executeTool(part);
					queue.push({ type: "answered", result });

					return {
						content: ClaudeCodeUtils.toToolContent(result),
						isError: result.error,
					};
				},

				async canUseTool({ toolUseId }) {
					const part = reader.getCall(toolUseId);
					if (!part) return { allow: false, message: "Unknown tool call" };

					return ask(part);
				},
			});

			/**
			 * Sends what the user queued into the session, which reads it at its next
			 * step. Returns whether there was anything.
			 */
			let closed = false;

			const sendQueued = async () => {
				if (closed) return false;

				const parts = (await interjections?.()) ?? [];
				for (const part of parts) {
					queue.push({ type: "interjection", part });
					await bridge.send(id, await ClaudeCodeUtils.getBlocksOf(part.value));
				}
				return parts.length > 0;
			};

			const close = () => {
				if (closed) return;
				closed = true;
				void bridge.close(id);
			};

			const polling = interjections
				? setInterval(() => void sendQueued(), QUEUE_MS)
				: undefined;

			// A cancelled run may not report its end.
			const cancel = () => {
				closed = true;
				void bridge.cancel(id);
				queue.push({ type: "end" });
			};
			if (abortSignal?.aborted) cancel();
			else abortSignal?.addEventListener("abort", cancel, { once: true });

			try {
				while (true) {
					const event = await queue.next();
					if (event.type === "end") break;
					if (event.type === "error") throw new Error(event.message);
					if (event.type === "refresh") {
						const part = reader.getCall(event.id);
						// A subagent's call shows again through its conversation.
						if (part && !reader.refresh(event.id))
							yield { type: "data", value: part } satisfies zAgentEvent;
					} else if (event.type === "answered") {
						yield {
							type: "data",
							value: { ...event.result, signature: reader.signature() },
						};
					} else if (event.type === "interjection") {
						yield { type: "data", value: event.part };
					} else if (event.type === "changes") {
						// Usually ahead of the result it goes with; if not, the
						// result is shown again with it.
						changes.set(event.toolUseId, event.changes);
						const result = results.get(event.toolUseId);
						if (result)
							yield {
								type: "data",
								value: { ...result, changes: event.changes },
							};
					} else {
						for (let read of reader.read(event.message)) {
							if (read.type === "data" && read.value.type === "toolCall")
								watch(read.value);
							if (read.type === "data" && read.value.type === "toolResult") {
								const changed = changes.get(read.value.id);
								if (changed)
									read = {
										...read,
										value: { ...read.value, changes: changed },
									};
								results.set(read.value.id, read.value as zToolResultPart);
							}
							yield read;
						}
						// Done, unless the user queued more meanwhile: the session goes on
						// with it, and the run ends once it has answered everything.
						if (event.message.type === "result" && !(await sendQueued()))
							close();
					}
				}
			} finally {
				clearInterval(polling);
				abortSignal?.removeEventListener("abort", cancel);
				close();
			}
		},
	};
};
