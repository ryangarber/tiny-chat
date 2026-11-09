import { parsePartialJson } from "ai";
import type { z } from "zod";
import type { Capabilities } from "#core/core/types/capability.ts";
import type { zClientEnv } from "#core/core/types/env.ts";
import type { StreamMutation } from "#core/core/types/stream.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { AgentInstructionsService } from "#core/features/agent/services/AgentInstructionsService.ts";
import { AgentMessagesService } from "#core/features/agent/services/AgentMessagesService.ts";
import {
	AgentTokensService,
	type CompactionResult,
} from "#core/features/agent/services/AgentTokensService.ts";
import { PlanService } from "#core/features/agent/services/PlanService.ts";
import type {
	zAgentContext,
	zAgentEvent,
} from "#core/features/agent/types/agent.ts";
import { AgentUtils } from "#core/features/agent/utils/AgentUtils.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import type {
	zData,
	zDataPart,
	zInterjectionPart,
	zMetadata,
	zToolCallPart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";
import { FileChangeService } from "#core/features/file/services/FileChangeService.ts";
import {
	ModelProviderService,
	type RunLanguageModelOptions,
} from "#core/features/provider/services/ModelProviderService.ts";
import type { ModelProvider } from "#core/features/provider/types/model.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFeedback,
	Toolset,
} from "#core/features/tool/types/tool.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";
import { VERBOSE } from "#core/logger.ts";

/** How often a streaming tool call's partial input is re-parsed. */
const PARTIAL_INPUT_MS = 50;

export const AgentService = {
	build: async ({
		context,
		capabilities,
		toolsets,
		skills,
		skipInstructions,
	}: {
		context: zAgentContext;
		capabilities: Capabilities;
		toolsets: Toolset<any>[];
		skills: zSkill[];
		skipInstructions?: boolean;
	}) => {
		const { prompt } = AgentUtils.getLastPrompt({
			messages: context.messages,
			withText: false,
		});

		const enabledToolsets = toolsets.filter(
			(toolset) =>
				toolset.status.valid &&
				(toolset.when
					? toolset.when(context)
					: prompt?.config?.toolsets?.includes(ToolUtils.name({ toolset }))),
		);
		if (VERBOSE) console.log("[AgentService] enabled tools:", enabledToolsets);
		const enabledSkills = skills.filter(
			(skill) => skill.name && prompt?.config?.skills?.includes(skill.path),
		);
		if (VERBOSE) console.log("[AgentService] enabled skills:", enabledSkills);
		const enabledTools = enabledToolsets.flatMap((toolset) =>
			toolset.tools
				.map((tool) => ({
					...tool,
					name: ToolUtils.name({ toolset, tool }),
				}))
				.filter((tool) => context.interactive || !tool.feedback),
		);

		const { messages, customInstructions } =
			await AgentMessagesService.buildMessages({
				context,
				capabilities,
				enabledToolsets,
			});

		const instructions = skipInstructions
			? undefined
			: (customInstructions ??
				(await AgentInstructionsService.buildInstructions({
					context,
					config: prompt?.config,
					capabilities,
					enabledToolsets,
					enabledSkills,
				})));

		if (VERBOSE)
			console.log("[AgentService] built agent:", { messages, instructions });

		return {
			config: prompt?.config,
			enabledToolsets,
			enabledTools,
			messages,
			instructions,
		};
	},

	/** A call of the provider's own, asked about, that the user hasn't answered. */
	isApproving: (part: zToolCallPart) =>
		!!part.providerExecuted &&
		!!part.validation?.approval &&
		part.validation.approved === undefined,

	/** A call anywhere in a reply. */
	findCall: (data: zData, id: string) =>
		data
			.flat()
			.find(
				(part): part is zToolCallPart =>
					part.type === "toolCall" && part.id === id,
			),

	/** Whether a call anywhere in a reply has its result. */
	hasResult: (data: zData, id: string) =>
		data.flat().some((part) => part.type === "toolResult" && part.id === id),

	/**
	 * The chat's local folders, the primary one first, where a local agent
	 * runs: the shell's directory without any.
	 */
	getLocalFolders: async (capabilities: Capabilities): Promise<string[]> => {
		try {
			const shell = capabilities.shell;
			if (!shell) return [];
			const folders = (await shell.folders?.()) ?? [];
			if (folders.length) return folders;
			const cwd = await shell.cwd?.();
			return cwd ? [cwd] : [];
		} catch {
			return [];
		}
	},

	estimate: async ({
		context,
		capabilities,
		config,
		toolsets,
		skills,
		supportsTools = true,
		skipInstructions,
	}: {
		context: zAgentContext;
		capabilities: Capabilities;
		config: zConfig;
		toolsets: Toolset<any>[];
		skills: zSkill[];
		supportsTools?: boolean;
		skipInstructions?: boolean;
	}): Promise<CompactionResult> => {
		const { messages, instructions, enabledTools } = await AgentService.build({
			context,
			capabilities,
			toolsets,
			skills,
			skipInstructions,
		});

		return await AgentTokensService.compactMessages({
			messages,
			instructions,
			config,
			tools: supportsTools ? enabledTools : [],
		});
	},

	generate: async function* ({
		provider,
		context,
		capabilities,
		toolsets,
		skills,
		data,
		metadata,
		env,
		instructions: extraInstructions,
		options,
		toolStream,
		toolSignal,
		toolFeedback,
		interjections,
	}: {
		provider: ModelProvider<any>;
		context: zAgentContext;
		capabilities: Capabilities;
		toolsets: Toolset<any>[];
		skills: zSkill[];
		data: zData;
		metadata: zMetadata;
		env: Partial<zClientEnv>;
		/**
		 * Added to the normal chat instructions for specialized agent runs, which
		 * still need the chat's context: its project, folders, tools and skills.
		 */
		instructions?: string;
		options?: Partial<Omit<RunLanguageModelOptions, "system">>;
		/** Drain user messages queued for the next model step. */
		interjections?: () => zInterjectionPart[] | Promise<zInterjectionPart[]>;
		/** Output a tool reports while it is still running, keyed by call id */
		toolStream?: (_: {
			/** Unset for one of an agent's own calls. */
			tool?: Tool<any, any>;
			part: zToolCallPart;
			mutation: StreamMutation<
				z.infer<Exclude<ToolDefinition["stream"], void>>
			>;
		}) => void;
		/**
		 * Stops one tool call without stopping the generation. An interrupted
		 * call ends the loop so the model waits for the user rather than retrying.
		 */
		toolSignal?: (_: { part: zToolCallPart }) => AbortSignal | undefined;
		/**
		 * Waits on the user's answer to a call that needs one. It is asked only
		 * while the generation has other calls to wait on anyway; `signal` aborts
		 * once it stops waiting, and the call is then answered after it ends.
		 */
		toolFeedback?: (_: {
			part: zToolCallPart;
			signal: AbortSignal;
		}) => Promise<ToolFeedback>;
	}) {
		const {
			config,
			enabledToolsets,
			enabledTools,
			messages,
			instructions: builtInstructions,
		} = await AgentService.build({
			context,
			capabilities,
			toolsets,
			skills,
		});
		const instructions =
			[builtInstructions, extraInstructions].filter(Boolean).join("\n\n") ||
			undefined;

		// A plan is a file from the moment it is asked for, so it is in the
		// chat's sources and an edit has something to land on.
		const chatId = context.chat?.id;
		if (chatId && PlanService.isActive(context.messages)) {
			await PlanService.ensure({ capabilities, chatId }).catch((error) =>
				console.warn("[AgentService] could not create the plan:", error),
			);
		}

		if (!config) throw new Error("missing config");
		const supportsTools = (
			await provider.getStatus({ user: context.user })
		).models
			.find((model) => model.name === config.model)
			?.features.includes("language:tools");

		// The tools only the provider's model calls (Claude Code's questions),
		// found as Tiny Chat's own are, but never offered to the model by it.
		const providerTools = provider.getTools?.({ config }) ?? [];
		const lookupToolsets: Toolset<any>[] = providerTools.length
			? [
					...enabledToolsets,
					{
						name: provider.name,
						tools: providerTools,
						capabilities: undefined,
						status: { valid: true },
					} as Toolset<any>,
				]
			: enabledToolsets;

		const toolValidationErrors = new Map<string, unknown>();

		/** Raw input text of tool calls the model is still writing. */
		const toolInputs = new Map<string, { text: string; parsedAt: number }>();

		let parts = data[data.length - 1];

		const push = (part: zDataPart): zAgentEvent => {
			if (!parts) {
				console.warn(
					"[AgentService] parts array is undefined - this should not happen",
				);
				data.push([]);
				parts = data[data.length - 1];
			}
			parts.push(part);
			return { type: "data", value: part };
		};

		/**
		 * Files changed by calls of tools that do not say what they change,
		 * shown beside their results as diffs.
		 */
		const changes = capabilities.shell
			? FileChangeService.createTracker({
					shell: capabilities.shell,
					folders: () => AgentService.getLocalFolders(capabilities),
				})
			: undefined;

		/** Runs one call to its result. Never rejects. */
		const execute = async ({
			toolCall,
			tool,
			feedback,
			signal,
		}: {
			toolCall: zToolCallPart;
			tool: Tool<any, any>;
			feedback?: unknown;
			signal?: AbortSignal;
		}): Promise<{ result: zToolResultPart; interrupted: boolean }> => {
			const signals = [
				options?.abortSignal,
				toolSignal?.({ part: toolCall }),
				signal,
			].filter((signal) => !!signal);
			const abort = signals.length ? AbortSignal.any(signals) : undefined;

			try {
				if (VERBOSE)
					console.log(
						`[AgentService] running tool ${toolCall.name} with args:`,
						toolCall.input,
					);
				const value = await ToolCallUtils.interruptible(
					tool.execute({
						id: toolCall.id,
						input: toolCall.input,
						feedback,
						context,
						stream: toolStream
							? (mutation) => toolStream({ tool, part: toolCall, mutation })
							: undefined,
						abort,
					}),
					abort,
				);
				if (VERBOSE)
					console.log(
						`[AgentService] tool ${toolCall.name} finished with result:`,
						value,
					);
				return {
					interrupted: false,
					result: {
						type: "toolResult",
						id: toolCall.id,
						name: toolCall.name,
						output: value.map((part) => ({
							...part,
							id: CommonUtils.getRandomId(),
						})),
					},
				};
			} catch (error: any) {
				if (abort?.aborted) {
					console.log(`[AgentService] tool ${toolCall.name} interrupted`);
					return {
						interrupted: true,
						result: {
							type: "toolResult",
							id: toolCall.id,
							name: toolCall.name,
							error: true,
							output: ToolCallUtils.getInterruption(),
						},
					};
				}
				console.warn(
					`[AgentService] error running tool ${toolCall.name}:`,
					error,
				);
				return {
					interrupted: false,
					result: {
						type: "toolResult",
						id: toolCall.id,
						name: toolCall.name,
						error: true,
						output: [
							{
								type: "text",
								value: CommonUtils.formatError({ error, details: true }),
								id: CommonUtils.getRandomId(),
							},
						],
					},
				};
			}
		};

		/**
		 * Whether the provider runs tools of its own, whose changes are then
		 * looked for from the start of each step: such a call can be running
		 * before its part arrives (Codex reports a command once it has begun).
		 */
		const runsTools = !!changes && !!provider.runsTools?.({ config });

		/** The provider's own calls being watched for changes, by call id. */
		const watching = new Set<string>();

		/** Watches a call the provider runs, from now until its result. */
		const watch = async (part: zToolCallPart) => {
			if (
				!changes ||
				watching.has(part.id) ||
				!ToolCallUtils.tracksChanges({ tool: null, name: part.name })
			)
				return;
			watching.add(part.id);
			await changes.begin();
		};

		/** Lets go of a call that won't run yet, such as one asking approval. */
		const unwatch = (id: string) => {
			if (watching.delete(id)) changes?.cancel();
		};

		/** What a watched call changed, put on its result. */
		const watched = async (result: zToolResultPart) => {
			if (!watching.delete(result.id)) return;
			// Its window would take in every call made while it runs.
			if (ToolCallUtils.isBackground(result.output)) {
				changes?.cancel();
				return;
			}
			const changed = await changes?.end();
			if (changed) result.changes = changed;
		};

		/** {@link execute}, with what the call changed when its tool tracks it. */
		const run = async (
			args: Parameters<typeof execute>[0] & { track?: boolean },
		) => {
			const tracker =
				args.track !== false &&
				ToolCallUtils.tracksChanges({
					tool: args.tool,
					name: args.toolCall.name,
				})
					? changes
					: undefined;
			await tracker?.begin();
			const ran = await execute(args);
			const changed = await tracker?.end();
			if (changed) ran.result.changes = changed;
			return ran;
		};

		/**
		 * Calls running in the background, by call id. Each settles once the part
		 * reporting it is in `finished`, which the model reads at its next step.
		 * They are stopped with the generation, and when it fails.
		 */
		const background = new Map<string, Promise<void>>();
		const finished: zInterjectionPart[] = [];
		const backgroundAbort = new AbortController();
		const runInBackground = (
			toolCall: zToolCallPart,
			tool: Tool<any, any>,
			feedback?: unknown,
		) => {
			background.set(
				toolCall.id,
				// Untracked: its window would overlap every call made meanwhile.
				run({
					toolCall,
					tool,
					feedback,
					signal: backgroundAbort.signal,
					track: false,
				}).then(({ result }) => {
					background.delete(toolCall.id);
					finished.push({
						id: CommonUtils.getRandomId(),
						type: "interjection",
						value: result.output,
						task: {
							id: toolCall.id,
							name: toolCall.name,
							error: result.error,
						},
					});
				}),
			);
		};

		// A background call the user approved settles with its placeholder before
		// this generation resumes, and starts here.
		for (const part of data.flat()) {
			if (
				part.type !== "toolResult" ||
				!ToolCallUtils.isBackground(part.output) ||
				data
					.flat()
					.some((p) => p.type === "interjection" && p.task?.id === part.id)
			)
				continue;
			const toolCall = data
				.flat()
				.find(
					(p): p is zToolCallPart => p.type === "toolCall" && p.id === part.id,
				);
			const { tool } = toolCall
				? ToolUtils.find({ toolsets: lookupToolsets, part: toolCall })
				: { tool: null };
			if (toolCall && tool) runInBackground(toolCall, tool);
		}

		/**
		 * Settles one step's calls, running them together except that a
		 * sequential one runs alone. Results land as calls finish, then are put
		 * back in the order of the calls.
		 *
		 * A call that waits on the user is answered here while there is anything
		 * else to wait on — a call still running, or one in the background — so
		 * the user is never kept from answering by work they are not waiting
		 * for. Once there is nothing else, the generation ends and the call is
		 * answered when it resumes. Returns whether it must stop: a call is
		 * still waiting, or the user interrupted one.
		 */
		const settleCalls = async function* (
			toolCalls: zToolCallPart[],
		): AsyncGenerator<zAgentEvent, boolean> {
			let interrupted = false;

			/** Calls to run, in the order they were made or answered. */
			const queue: {
				toolCall: zToolCallPart;
				tool: Tool<any, any>;
				feedback?: unknown;
			}[] = [];
			/** Calls waiting on the user, by call id. */
			const waiting = new Map<
				string,
				{ toolCall: zToolCallPart; tool: Tool<any, any> | null }
			>();

			for (const toolCall of toolCalls) {
				// The provider's own: only its approval is Tiny Chat's to settle.
				if (toolCall.providerExecuted) {
					waiting.set(toolCall.id, { toolCall, tool: null });
					continue;
				}

				const { tool } = ToolUtils.find({
					toolsets: lookupToolsets,
					part: toolCall,
				});

				if (!tool) {
					yield push({
						type: "toolResult",
						id: toolCall.id,
						name: toolCall.name,
						error: true,
						output: [
							{
								id: CommonUtils.getRandomId(),
								type: "text",
								value: `Tool "${toolCall.name}" not found`,
							},
						],
					});
					continue;
				}

				if (toolValidationErrors.has(toolCall.id)) {
					yield push({
						type: "toolResult",
						id: toolCall.id,
						name: toolCall.name,
						error: true,
						output: [
							{
								id: CommonUtils.getRandomId(),
								type: "text",
								value: CommonUtils.formatError({
									error: toolValidationErrors.get(toolCall.id),
									details: true,
								}),
							},
						],
					});
					continue;
				}

				if (tool.feedback || toolCall.validation?.approval) {
					waiting.set(toolCall.id, { toolCall, tool });
					continue;
				}

				queue.push({ toolCall, tool });
			}

			type Settled =
				| {
						type: "result";
						result: zToolResultPart;
						interrupted: boolean;
				  }
				| { type: "answer"; id: string; answer?: ToolFeedback }
				| { type: "background" };

			const answering = new AbortController();
			const answers = new Map<string, Promise<Settled>>();
			if (toolFeedback) {
				const signal = AbortSignal.any(
					[answering.signal, options?.abortSignal].filter((s) => !!s),
				);
				for (const [id, { toolCall }] of waiting) {
					answers.set(
						id,
						toolFeedback({ part: toolCall, signal }).then(
							(answer): Settled => ({ type: "answer", id, answer }),
							(): Settled => ({ type: "answer", id }),
						),
					);
				}
			}

			/** Rejects an answered call, or queues it to run. */
			const accept = async function* (
				settled: Settled,
			): AsyncGenerator<zAgentEvent> {
				if (settled.type !== "answer" || !settled.answer) return;
				const call = waiting.get(settled.id);
				if (!call) return;
				waiting.delete(settled.id);
				// The provider runs it, or not, once it reads the answer next step.
				if (!call.tool) {
					call.toolCall.validation = {
						...call.toolCall.validation,
						approved: !!settled.answer.approved,
					};
					yield { type: "data", value: call.toolCall };
					return;
				}
				if (call.toolCall.validation?.approval && !settled.answer.approved) {
					yield push({
						type: "toolResult",
						id: call.toolCall.id,
						name: call.toolCall.name,
						error: true,
						output: ToolCallUtils.getRejection(),
					});
				} else {
					queue.push({
						toolCall: call.toolCall,
						tool: call.tool,
						feedback: settled.answer.feedback,
					});
				}
			};

			const running = new Map<
				string,
				{
					sequential: boolean;
					done: Promise<{ result: zToolResultPart; interrupted: boolean }>;
				}
			>();

			try {
				while (true) {
					while (queue.length && !interrupted) {
						const [{ toolCall, tool, feedback }] = queue;
						const sequential = !!tool.sequential;
						const blocked = [...running.values()].some(
							(call) => call.sequential || sequential,
						);
						if (blocked) break;
						queue.shift();

						if (ToolCallUtils.isBackgrounded({ tool, part: toolCall })) {
							runInBackground(toolCall, tool, feedback);
							yield push({
								type: "toolResult",
								id: toolCall.id,
								name: toolCall.name,
								output: ToolCallUtils.getBackground({ id: toolCall.id }),
							});
							continue;
						}

						running.set(toolCall.id, {
							sequential,
							done: run({ toolCall, tool, feedback }),
						});
					}

					// Calls not yet started are not run: the user stepped in.
					if (interrupted) {
						for (const { toolCall } of queue.splice(0)) {
							yield push({
								type: "toolResult",
								id: toolCall.id,
								name: toolCall.name,
								error: true,
								output: ToolCallUtils.getInterruption(),
							});
						}
					}

					// Nothing else to wait on: what is still unanswered is answered
					// once the generation resumes.
					if (
						answers.size &&
						(interrupted ||
							options?.abortSignal?.aborted ||
							(!running.size && !queue.length && !background.size))
					) {
						answering.abort();
						// Every wait settles on the abort; an answer given just before
						// it still counts.
						const late = await Promise.all(answers.values());
						answers.clear();
						for (const settled of late) yield* accept(settled);
						continue;
					}

					if (!running.size && !answers.size) break;

					const settled = await Promise.race<Settled>([
						...[...running.values()].map(({ done }) =>
							done.then((done): Settled => ({ type: "result", ...done })),
						),
						...answers.values(),
						// A background call finishing may leave nothing else to wait on.
						...(answers.size
							? [...background.values()].map(
									(done): Promise<Settled> =>
										done.then(() => ({ type: "background" })),
								)
							: []),
					]);

					if (settled.type === "result") {
						running.delete(settled.result.id);
						if (settled.interrupted) interrupted = true;
						yield push(settled.result);
					} else if (settled.type === "answer") {
						answers.delete(settled.id);
						yield* accept(settled);
					}
				}
			} finally {
				answering.abort();
			}

			parts.splice(
				0,
				parts.length,
				...AgentUtils.getToolResultsSorted({ data: parts }),
			);

			return interrupted || waiting.size > 0;
		};

		// A generation resumed with calls still to settle settles them before the
		// model goes on: the user has answered at least one of them.
		const unsettled =
			parts?.filter(
				(part): part is zToolCallPart =>
					part.type === "toolCall" &&
					!part.partial &&
					!parts.some((p) => p.type === "toolResult" && p.id === part.id) &&
					// The provider's own wait only on an approval not yet given.
					(!part.providerExecuted || AgentService.isApproving(part)),
			) ?? [];
		const resumed = unsettled.length ? !(yield* settleCalls(unsettled)) : true;

		/** The provider's calls that can be stopped on their own. */
		const stoppable = new Set<string>();

		// Agentic loop: keep generating until the model stops calling tools
		while (resumed) {
			/** Why the step ended, and whether the provider asks to go on. */
			let finishReason: string | undefined;
			let goOn = false;
			messages[messages.length - 1].data = data;

			parts = data[data.length - 1];

			/**
			 * Drop calls the model never finished writing. They carry no usable
			 * input and must not be persisted or sent back to the model.
			 */
			const settle = () => {
				toolInputs.clear();
				for (let i = (parts?.length ?? 0) - 1; i >= 0; i--) {
					const part = parts[i];
					if (part.type === "toolCall" && part.partial) parts.splice(i, 1);
				}
			};

			/** Whether this step holds a window open for the provider's calls. */
			let stepWindow = false;

			try {
				if (options?.abortSignal?.aborted) break;
				for (const part of [
					...finished.splice(0),
					...((await interjections?.()) ?? []),
				])
					yield push(part);
				if (runsTools && changes) {
					stepWindow = true;
					await changes.begin();
					// What the user approved, the provider runs in this step.
					for (const part of data.flat())
						if (
							part.type === "toolCall" &&
							part.providerExecuted &&
							part.validation?.approved &&
							!AgentService.hasResult(data, part.id)
						)
							await watch(part);
				}
				// A provider that keeps its own context is sent the chat whole.
				const sent = provider.keepsContext
					? messages
					: (
							await AgentTokensService.compactMessages({
								instructions,
								messages,
								config,
								tools: supportsTools ? enabledTools : [],
							})
						).messages;
				const stream = ModelProviderService.runLanguageModel({
					user: context.user,
					provider,
					messages: sent,
					config,
					tools: enabledTools,
					env,
					context,
					folders: await AgentService.getLocalFolders(capabilities),
					options: {
						system: instructions,
						...options,
					},
				});

				for await (const event of stream) {
					if (event.type === "start") {
						console.log("[AgentService] starting step", {
							warnings: event.warnings,
						});
						data.push([]);
						parts = data[data.length - 1];
					}

					if (event.type === "toolInput") {
						if (event.name !== undefined) {
							toolInputs.set(event.id, { text: "", parsedAt: 0 });
							parts.push({
								type: "toolCall",
								id: event.id,
								name: event.name,
								input: {},
								partial: true,
							});
						} else if (event.delta) {
							const raw = toolInputs.get(event.id);
							const part = parts.find(
								(p): p is zToolCallPart =>
									p.type === "toolCall" && p.id === event.id && !!p.partial,
							);
							if (raw && part) {
								raw.text += event.delta;
								// Re-parsing the whole input on every token is quadratic in
								// its length, which a long file write makes noticeable.
								if (Date.now() - raw.parsedAt >= PARTIAL_INPUT_MS) {
									raw.parsedAt = Date.now();
									const { value } = await parsePartialJson(raw.text);
									// Replaced whole, so anything keyed on it sees the change.
									if (value && typeof value === "object") part.input = value;
								}
							}
						}
					}

					if (event.type === "approval") {
						const call = AgentService.findCall(data, event.id);
						if (call) call.validation = { ...call.validation, approval: true };
						// It runs once approved, in a step of its own.
						unwatch(event.id);
					}

					if (event.type === "toolStream") {
						const call = AgentService.findCall(data, event.id);
						if (call && toolStream) {
							// Stoppable once it shows it runs, as a subagent does.
							if (
								provider.stopToolCall &&
								toolSignal &&
								!stoppable.has(call.id)
							) {
								stoppable.add(call.id);
								toolSignal({ part: call })?.addEventListener(
									"abort",
									() => void provider.stopToolCall?.({ part: call }),
									{ once: true },
								);
							}
							toolStream({
								part: call,
								mutation: { mode: "replace", data: event.data },
							});
						}
					}

					if (event.type === "end") {
						const finish = (event.metadata as { type?: string }[]).findLast(
							(part) => part.type === "finish",
						) as { finishReason?: string } | undefined;
						finishReason = finish?.finishReason;
						goOn = !!provider.shouldContinue?.({ events: event.metadata });
					}

					if (event.type === "data") {
						if (event.value.type === "text") {
							type Text = typeof event.value;
							const existing = parts.find(
								(p): p is Text =>
									p.type === "text" && p.id === (event.value as Text).id,
							);
							if (existing) {
								existing.value += event.value.value;
								if (event.value?.signature)
									existing.signature = event.value.signature;
							} else {
								parts.push(event.value);
							}
						} else if (event.value.type === "thought") {
							type Thought = typeof event.value;
							const existing = parts.find(
								(p): p is Thought =>
									p.type === "thought" && p.id === (event.value as Thought).id,
							);
							if (existing) {
								existing.value += event.value.value;
								if (event.value?.signature)
									existing.signature = event.value.signature;
							} else {
								parts.push(event.value);
							}
						} else if (
							event.value.type === "toolCall" &&
							event.value.providerExecuted
						) {
							// Streamed again with an approval asked for later: it moves
							// to the step that asks.
							for (const slot of data) {
								const index = slot.findIndex(
									(p) => p.type === "toolCall" && p.id === event.value.id,
								);
								if (index !== -1 && slot !== parts) slot.splice(index, 1);
							}
							toolInputs.delete(event.value.id);
							const existing = parts.findIndex(
								(p) => p.type === "toolCall" && p.id === event.value.id,
							);
							if (existing === -1) parts.push(event.value);
							else parts[existing] = event.value;
							if (!AgentService.isApproving(event.value))
								await watch(event.value);
						} else if (event.value.type === "toolCall") {
							const { tool } = ToolUtils.find({
								toolsets: lookupToolsets,
								part: event.value,
							});
							if (tool?.validate) {
								try {
									event.value.validation = await tool.validate({
										input: event.value.input,
										context,
									});
								} catch (error) {
									console.warn(
										`[AgentService] tool ${event.value.name} failed validation:`,
										error,
									);
									toolValidationErrors.set(event.value.id, error);
								}
							}
							if (event.value.validation?.approval && !context.interactive) {
								toolValidationErrors.set(
									event.value.id,
									new Error(
										"This tool call cannot be completed as the user is not available to approve it.",
									),
								);
							}
							toolInputs.delete(event.value.id);
							const partial = parts.findIndex(
								(p) => p.type === "toolCall" && p.id === event.value.id,
							);
							if (partial === -1) parts.push(event.value);
							else parts[partial] = event.value;
						} else if (event.value.type === "toolResult") {
							await watched(event.value);
							// A provider may report a call's result again.
							const existing = parts.findIndex(
								(p) => p.type === "toolResult" && p.id === event.value.id,
							);
							if (existing === -1) parts.push(event.value);
							else parts[existing] = event.value;
						} else {
							parts.push(event.value);
						}
					}

					if (event.type === "end") {
						metadata.push(event.metadata);
					}

					yield event;
				}

				settle();

				if (options?.abortSignal?.aborted) {
					yield push({
						id: CommonUtils.getRandomId(),
						type: "abort",
						reason: "user",
						message: "Aborted",
						details: "",
					});
					break;
				}
			} catch (e: any) {
				console.error("[AgentService] error during stream:", e);
				settle();
				backgroundAbort.abort();
				yield push({
					id: CommonUtils.getRandomId(),
					type: "abort",
					reason: e.name === "AbortError" ? "user" : "error",
					message: e.message,
					details: JSON.stringify(e),
				});
				break;
			} finally {
				if (stepWindow) changes?.cancel();
			}

			// Tiny Chat's calls, and approvals of the provider's own it asked for.
			const toolCalls = [
				...parts.filter(
					(p): p is zToolCallPart =>
						p.type === "toolCall" && !p.providerExecuted,
				),
				...data
					.flat()
					.filter(
						(p): p is zToolCallPart =>
							p.type === "toolCall" &&
							AgentService.isApproving(p) &&
							!data
								.flat()
								.some((r) => r.type === "toolResult" && r.id === p.id),
					),
			];
			if (VERBOSE)
				console.log(
					`[AgentService] ${toolCalls.length} tools called:`,
					toolCalls,
				);

			const stop = yield* settleCalls(toolCalls);

			if (options?.abortSignal?.aborted) {
				yield push({
					id: CommonUtils.getRandomId(),
					type: "abort",
					reason: "user",
					message: "Aborted",
				});
				break;
			}
			if (stop) break;
			// A provider running its own calls goes on with the next step.
			if (!toolCalls.length && finishReason !== "tool-calls" && !goOn) {
				if (!background.size) {
					console.log("[AgentService] loop complete");
					break;
				}
				// The model is done for now, but a background call is not: wait for
				// one to report in, and let the model pick up from there.
				await Promise.race(background.values());
			}
		}

		// What never reported back is not waited for.
		for (const id of [...watching]) unwatch(id);

		// The generation does not end with calls still running in the background.
		await Promise.all(background.values());
		for (const part of finished.splice(0)) yield push(part);
	},
} as const;
