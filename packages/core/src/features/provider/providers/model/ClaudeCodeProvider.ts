import type { ProviderV4 } from "@ai-sdk/provider";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import type {
	zInterjectionPart,
	zToolCallPart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";
import type {
	ClaudeCodeBridge,
	ClaudeCodeEvent,
	ClaudeCodeHandlers,
	ClaudeCodeMode,
	ClaudeCodeRequest,
} from "#core/features/provider/types/claudeCode.ts";
import type {
	ModelProvider,
	zModel,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ClaudeCodeUtils } from "#core/features/provider/utils/ClaudeCodeUtils.ts";
import { AskQuestionUtils } from "#core/features/tool/tools/questions/ask_question.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

/** Claude Code's model aliases, which follow its newest models. */
const MODELS = ["haiku", "sonnet", "opus"];

const MODES: ClaudeCodeMode[] = ["claude-code", "tiny-chat"];

/** How often a run checks for messages the user queued. */
const QUEUE_MS = 1000;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const getMode = (config: zConfig): ClaudeCodeMode =>
	config.args?.mode === "tiny-chat" ? "tiny-chat" : "claude-code";

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
 * signed-in `claude`. It runs its own agent loop: with its own tools in
 * `claude-code` mode, or with Tiny Chat's, over MCP, in `tiny-chat` mode. The
 * host supplies only the {@link ClaudeCodeBridge}.
 */
export const createClaudeCodeProvider = (
	bridge: ClaudeCodeBridge,
): ModelProvider<ProviderV4> => ({
	name: "claude-code",
	type: "model",
	settings: [],

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

	async getStatus() {
		let status: Awaited<ReturnType<ClaudeCodeBridge["status"]>>;
		try {
			status = await bridge.status();
		} catch (error) {
			console.error("[ClaudeCodeProvider] status failed:", error);
			return { valid: false, error: "Failed to reach Claude Code", models: [] };
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
		return {
			valid: true,
			models: MODELS.map(
				(name): zModel => ({
					name,
					features: ["language", "language:tools"],
					args: this.getModelArgs({ model: name }),
				}),
			),
		};
	},

	getModelArgs() {
		return [
			{ type: "list", name: "mode", values: MODES, default: "claude-code" },
			{ type: "list", name: "effort", values: [...EFFORTS], default: "medium" },
		] satisfies zModelArg[];
	},

	hasOwnTools({ config }) {
		return getMode(config) === "claude-code";
	},

	async *runAgent({
		config,
		messages,
		system,
		tools,
		cwd,
		executeTool,
		approve,
		answer,
		interjections,
		abortSignal,
	}) {
		const mode = getMode(config);
		const resume = ClaudeCodeUtils.getSession(messages);
		const effort = EFFORTS.find((e) => e === config.args?.effort);
		const request: ClaudeCodeRequest = {
			model: config.model,
			effort,
			mode,
			system,
			prompt: await ClaudeCodeUtils.getPrompt(messages),
			resume,
			history: ClaudeCodeUtils.getHistory(messages),
			cwd,
			tools:
				mode === "tiny-chat"
					? tools.map((tool) => {
							const { inputSchema } = ToolUtils.getPromptDefinition(tool);
							return {
								name: tool.name,
								description: tool.description,
								inputSchema,
							};
						})
					: undefined,
		};

		const reader = ClaudeCodeUtils.createReader();
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
					if (part) yield { type: "data", value: part } satisfies zAgentEvent;
				} else if (event.type === "answered") {
					yield {
						type: "data",
						value: { ...event.result, signature: reader.signature() },
					};
				} else if (event.type === "interjection") {
					yield { type: "data", value: event.part };
				} else {
					yield* reader.read(event.message);
					// Done, unless the user queued more meanwhile: the session goes on
					// with it, and the run ends once it has answered everything.
					if (event.message.type === "result" && !(await sendQueued())) close();
				}
			}
		} finally {
			clearInterval(polling);
			abortSignal?.removeEventListener("abort", cancel);
			close();
		}
	},
});
