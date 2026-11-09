import type { Client } from "#client/client.ts";
import { ClientCapabilityService } from "#client/core/services/ClientCapabilityService.ts";
import {
	AgentStreamService,
	ToolStreamService,
} from "#client/core/services/StreamService.ts";
import { ClientProviderService } from "#client/features/agent/services/ClientProviderService.ts";
import { ChatSourcesService } from "#client/features/chat/services/ChatSourcesService.ts";
import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";
import { ToolFeedbackService } from "#client/features/part/services/ToolFeedbackService.ts";
import { AgentService } from "#core/features/agent/services/AgentService.ts";
import type {
	zAgentChat,
	zAgentContext,
} from "#core/features/agent/types/agent.ts";
import { AgentUtils } from "#core/features/agent/utils/AgentUtils.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData, zMetadata } from "#core/features/data/types/part.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import { ToolService } from "#core/features/tool/services/ToolService.ts";
import { isPlanChange, plan } from "#core/features/tool/tools/plan/plan.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

export const ClientAgentService = {
	/** Run the generation loop, pumping deltas into the stream registry. */
	runAgent: async ({
		client,
		context,
		data = [],
		metadata = [],
		skills,
		chat,
		prompt,
		mcpTools,
		providers,
		streamKey,
		streamChat,
		toolNames,
		instructions,
		onData,
	}: {
		client: Client;
		context: zAgentContext;
		data?: zData;
		metadata?: zMetadata;
		chat: zAgentChat;
		prompt: MessageState;
		skills: zSkill[];
		mcpTools: Toolset<any>[];
		providers: ProviderState<ProviderStatus>[];
		streamKey: string;
		streamChat: string | null;
		toolNames?: string[];
		instructions?: string;
		/** `data` has changed, as it does on every event while it streams. */
		onData?: () => void;
	}): Promise<{ data: zData; metadata: zMetadata }> => {
		console.log(
			"[ClientAgentService] running agent",
			context,
			skills,
			providers,
		);

		const modelProviders = await ClientProviderService.getModelProviders({
			client,
			user: context.user,
		});

		const { prompt: lastPrompt } = AgentUtils.getLastPrompt({
			messages: context.messages,
			withText: false,
		});
		const provider = modelProviders.find(
			(p) => p.name === lastPrompt?.config?.provider,
		);
		if (!provider) {
			throw new Error(`Provider "${lastPrompt?.config?.provider}" not found`);
		}

		const capabilities = await ClientCapabilityService.getCapabilities({
			client,
			user: context.user,
			chat,
			message: prompt,
			messages: context.messages,
			providers,
			incognito: chat.incognito,
			temporary: chat.temporary,
			skills,
			mcpTools,
		});

		let toolsets = [
			...mcpTools,
			...(await ToolService.getTools({
				capabilities,
			})),
		];
		if (toolNames) {
			toolsets = toolsets
				.map((toolset) => ({
					...toolset,
					tools: toolset.tools.filter((tool) => toolNames.includes(tool.name)),
				}))
				.filter((toolset) => toolset.tools.length > 0);
		}

		const abort = AgentStreamService.start(streamKey, {
			chat: streamChat,
			initial: {
				data: [...data],
			},
		});

		AgentStreamService.mutate(streamKey, {
			mode: "patch",
			data: { status: "pending" },
		});
		// Counted from the start, so a generation that never gets as far as its
		// first output is still caught by whatever is watching it.
		onData?.();

		const agent = AgentService.generate({
			provider,
			context,
			capabilities,
			toolsets,
			skills,
			data,
			metadata,
			instructions,
			env: client.providerEnv,
			options: {
				abortSignal: abort.signal,
			},
			interjections: streamChat
				? () => useMessageQueueStore.getState().drain(streamChat)
				: undefined,
			// The call's stream carries its abort, so the stop on a running call
			// reaches the tool. Started here rather than on first output, since a
			// call that hangs before writing anything is the one to stop.
			toolSignal: ({ part }) => ToolStreamService.start(part.id).signal,
			// Only the user can answer, and only in a chat they are in.
			toolFeedback: context.interactive
				? (feedback) =>
						ToolFeedbackService.wait({ ...feedback, chatId: streamChat })
				: undefined,
			toolStream: ({ part, mutation }) => {
				if (!ToolStreamService.get(part.id)) {
					ToolStreamService.start(part.id);
				}
				ToolStreamService.mutate(part.id, mutation);
			},
		});

		// The plan opens in the chat's sources the first time it is written in a
		// run, and is only refreshed after that, so closing it sticks.
		let planShown = false;

		try {
			for await (const event of agent) {
				if (event.type === "toolInput" && event.name !== undefined) {
					AgentStreamService.mutate(streamKey, {
						mode: "patch",
						data: { status: "generating" },
					});
				}
				if (event.type === "data") {
					if (event.value.type === "text" || event.value.type === "json") {
						AgentStreamService.mutate(streamKey, {
							mode: "patch",
							data: { status: "generating" },
						});
					} else if (event.value.type === "thought") {
						AgentStreamService.mutate(streamKey, {
							mode: "patch",
							data: { status: "thinking" },
						});
					}
					if (event.value.type === "toolResult")
						ToolFeedbackService.settle(event.value.id);
					if (
						event.value.type === "toolResult" &&
						event.value.name === plan.name &&
						!event.value.error &&
						isPlanChange(ToolUtils.json<typeof plan>(event.value)) &&
						chat.id
					) {
						void ChatSourcesService.showPlan({
							client,
							chatId: chat.id,
							open: !planShown,
						});
						planShown = true;
					}
					if (
						event.value.type === "toolResult" &&
						// A call settles with this while it runs on in the background.
						!ToolCallUtils.isBackground(event.value.output)
					) {
						ToolStreamService.clear(event.value.id);
					} else if (event.value.type === "interjection" && event.value.task) {
						ToolStreamService.clear(event.value.task.id);
					}
				}

				AgentStreamService.mutate(streamKey, { mode: "patch", data: { data } });
				onData?.();
			}
		} finally {
			// Answers the generation did not get to are given again once it is
			// over — unless one is held for the generation that follows it.
			for (const part of data.flat())
				if (
					part.type === "toolCall" &&
					(abort.signal.aborted || !ToolFeedbackService.isHeld(part.id))
				)
					ToolFeedbackService.settle(part.id);
		}

		return { data, metadata };
	},
} as const;
