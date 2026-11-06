import type { Client } from "#client/client.ts";
import { AgentStreamService } from "#client/core/services/StreamService.ts";
import { ClientAgentService } from "#client/features/agent/services/ClientAgentService.ts";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";
import { MessageQueryService } from "#client/features/message/services/MessageQueryService.ts";
import { useToolFeedbackStore } from "#client/features/part/stores/useToolFeedbackStore.ts";
import { UserService } from "#client/features/user/services/UserService.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { TypeUtils } from "#core/core/utils/TypeUtils.ts";
import type { zAgentMessage } from "#core/features/agent/types/agent.ts";
import { AgentUtils } from "#core/features/agent/utils/AgentUtils.ts";
import type { ChatState } from "#core/features/data/types/chat.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type {
	zData,
	zDataPart,
	zMetadata,
} from "#core/features/data/types/part.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";

/**
 * Generations started in each chat, from the moment they are asked for until
 * they are saved: a generation is still being prepared for a while before its
 * stream shows it running.
 */
const generations = new Map<string, Set<Promise<void>>>();

/**
 * How often a reply being generated is saved as it stands, so a generation the
 * app never gets to finish leaves what it had rather than nothing.
 */
const CHECKPOINT_INTERVAL_MS = 3000;

/** Resolves once the chat's agent stream is cleared. */
const streamCleared = (chatId: string) =>
	new Promise<void>((resolve) => {
		if (!useStreamStore.getState().chatAgentStreams.has(chatId)) {
			resolve();
			return;
		}
		const unsubscribe = useStreamStore.subscribe((state) => {
			if (state.chatAgentStreams.has(chatId)) return;
			unsubscribe();
			resolve();
		});
	});

/**
 * Agent orchestration for messages.
 */
export const ClientMessageService = {
	/** Whether nothing is generating in the chat, nor about to. */
	isIdle: (chatId: string) =>
		!generations.get(chatId)?.size &&
		!useStreamStore.getState().chatAgentStreams.has(chatId),

	/** Resolves once nothing is generating in the chat, nor about to. */
	idle: async (chatId: string) => {
		while (!ClientMessageService.isIdle(chatId)) {
			const pending = generations.get(chatId);
			if (pending?.size) await Promise.all(pending);
			else await streamCleared(chatId);
		}
	},

	/** Counts a generation as started in the chat until the returned call. */
	_track: (chatId: string) => {
		let resolve!: () => void;
		const done = new Promise<void>((r) => {
			resolve = r;
		});
		const pending = generations.get(chatId) ?? new Set();
		pending.add(done);
		generations.set(chatId, pending);
		return () => {
			pending.delete(done);
			if (!pending.size && generations.get(chatId) === pending)
				generations.delete(chatId);
			resolve();
		};
	},

	/**
	 * Trigger model generation for an existing user message. If `message` is a
	 * model reply, the seed user message is resolved automatically. When
	 * `toolResults` are provided, they are inserted into the last data slot
	 * of the reply before generation continues.
	 */
	onMessage: async ({
		client,
		user,
		message,
		chat,
		toolResults,
		mcpTools,
		providers,
		skills,
		resume = true,
		answered = false,
	}: {
		client: Client;
		user: zUser;
		message: MessageState;
		chat: ChatState;
		providers: ProviderState<ProviderStatus>[];
		skills: zSkill[];
		mcpTools: Toolset<any>[];
		toolResults?: zDataPart[];
		/** False to only record `toolResults`, leaving the model to wait. */
		resume?: boolean;
		/**
		 * The user has answered a call the reply still waits on, so it resumes
		 * to run it even while other calls wait on the user too.
		 */
		answered?: boolean;
	}): Promise<void> => {
		console.log(
			"[ClientMessageService] handling model message",
			message,
			chat,
			toolResults,
			message.author === "MODEL" ? message.id : undefined,
		);

		if (!mcpTools) {
			console.warn(`[ClientMessageService] continuing with no mcp tool data`);
			mcpTools = [];
		}

		// Counted from here, before anything is awaited, so whoever checks the
		// chat next sees it busy.
		const done = ClientMessageService._track(chat.id);
		let started = false;
		try {
			await ClientMessageService._run({
				client,
				user,
				message,
				chat,
				toolResults,
				mcpTools,
				providers,
				skills,
				resume,
				answered,
				onStart: () => {
					started = true;
				},
				onDone: done,
			});
		} finally {
			if (!started) done();
		}
	},

	_run: async ({
		client,
		user,
		message,
		chat,
		toolResults,
		mcpTools,
		providers,
		skills,
		resume,
		answered,
		onStart,
		onDone,
	}: {
		client: Client;
		user: zUser;
		message: MessageState;
		chat: ChatState;
		providers: ProviderState<ProviderStatus>[];
		skills: zSkill[];
		mcpTools: Toolset<any>[];
		toolResults?: zDataPart[];
		resume: boolean;
		answered: boolean;
		/** The generation is running, and calls `onDone` once it is saved. */
		onStart: () => void;
		onDone: () => void;
	}): Promise<void> => {
		const branch = await ClientMessageService._getBranch(client, message);
		const prompt =
			message.author === "MODEL"
				? branch.find((m) => m.id === message.previousId)
				: message;
		if (!prompt) {
			throw new Error(`Could not find prompt (user) message for ${message.id}`);
		}

		const { response, messages } = await ClientMessageService._prepare(
			client,
			prompt,
			chat,
			branch,
			toolResults,
		);

		if (!resume) return;

		useMessageQueueStore.getState().setActive(chat.id, true);
		if (!answered && DataUtils.isMissingToolResult(response)) {
			// Awaiting more user tool inputs — do not start generation yet.
			return;
		}

		onStart();
		void (async () => {
			let failed = true;
			// Generated into a copy: the reply in the cache is what was last saved,
			// and stays that until the save lands.
			const working: MessageState = {
				...response,
				data: TypeUtils.deepClone(response.data),
			};
			// Only this generation's: the server adds it to what is stored.
			const metadata: zMetadata = [];
			const checkpoints = ClientMessageService._checkpoints(client, working);
			try {
				try {
					await ClientAgentService.runAgent({
						client,
						data: working.data,
						metadata,
						context: {
							user,
							chat,
							messages: messages.map((m) =>
								m.id === working.id ? { ...m, data: working.data } : m,
							),
							timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
							interactive: true,
						},
						chat,
						prompt,
						mcpTools,
						providers,
						skills,
						streamKey: response.id,
						streamChat: chat.id,
						onData: checkpoints.schedule,
					});
					failed = false;
				} catch (error) {
					// The generation stopped short: what it produced is kept, ending on
					// why, rather than the reply being left as it was before it ran.
					console.error("[ClientMessageService] generation failed:", error);
					ClientMessageService._abort(working.data, error);
				}
				// No checkpoint lands after the reply is saved as it ends.
				await checkpoints.stop();
				await ClientMessageService._finalize(client, working, metadata);
			} catch (error) {
				failed = true;
				console.error("[ClientMessageService] could not save reply:", error);
				await checkpoints.stop();
				await ClientMessageService._saveFailed(client, working, error);
			} finally {
				useMessageQueueStore.getState().finish(chat.id, working.data, failed);
				// Keep the live overlay until persisted content is in the cache.
				AgentStreamService.clear(response.id);
				onDone();
			}
		})();
	},

	/**
	 * The branch through `message`: the open chat's history when it holds it,
	 * which it does for anything sent or regenerated from the chat on screen.
	 */
	_getBranch: async (
		client: Client,
		message: MessageState,
	): Promise<MessageState[]> => {
		const cached = MessageQueryService.getCurrent(client, message.chatId);
		if (cached?.messages.some((m) => m.id === message.id))
			return cached.messages;
		const { active } = useChatStore.getState();
		const { messages } = await client.api.message.getMessages.query({
			chat: message.chatId,
			start: message.id,
			branches:
				active.status === "open" && active.chatId === message.chatId
					? active.branches
					: undefined,
		});
		return messages;
	},

	/** Find or create the model reply following `prompt` on `branch`. */
	_prepare: async (
		client: Client,
		prompt: MessageState,
		chat: ChatState,
		branch: MessageState[],
		toolResults?: zDataPart[],
	): Promise<{ response: MessageState; messages: zAgentMessage[] }> => {
		console.log(
			"[ClientMessageService] preparing response",
			prompt,
			chat,
			toolResults,
		);
		const index = branch.findIndex((m) => m.id === prompt.id);
		if (index < 0) throw new Error(`Prompt ${prompt.id} is not on its branch`);
		const next = branch[index + 1];
		const existing = next?.previousId === prompt.id ? next : undefined;

		let response: MessageState;
		if (existing) {
			// New results go into the reply's last step. Without any, the reply
			// starts over, and so does what the server keeps about it.
			const data: zData = toolResults
				? existing.data.map((d, i) =>
						i === existing.data.length - 1
							? AgentUtils.getToolResultsSorted({
									data: [...d, ...toolResults],
								})
							: d,
					)
				: [];
			response = await client.api.message.updateMessage.mutate({
				message: existing.id,
				config: prompt.config,
				author: existing.author,
				data,
				metadata: toolResults ? undefined : [],
				truncate: false,
			});
		} else {
			response = await client.api.message.createMessage.mutate({
				chat: prompt.chatId,
				author: "MODEL",
				config: prompt.config,
				data: [],
				previous: prompt.id,
				temporary: chat.temporary,
			});
		}

		await MessageQueryService.write(client, response, true);

		return {
			response,
			messages: [...branch.slice(0, index + 1), response].map(
				(message): zAgentMessage => ({
					id: message.id,
					author: message.author,
					data: message.data,
					config: message.config,
					createdAt: message.createdAt,
				}),
			),
		};
	},

	/**
	 * Saves `working` as it stands every so often while it generates, ending
	 * on a `checkpoint` abort, which only the save as it ends takes away. The
	 * cache takes each one too, so what reads it — the token estimate among
	 * them — keeps up with the reply; the stream's overlay hides the abort
	 * while it runs.
	 */
	_checkpoints: (client: Client, working: MessageState) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let saving = Promise.resolve();
		let stopped = false;

		const save = () => {
			timer = undefined;
			if (stopped) return;
			// Taken now: the generation goes on writing into `working.data`.
			const { awaiting } = useToolFeedbackStore.getState();
			const data = DataUtils.getCheckpoint({
				data: working.data,
				awaiting: (id) => awaiting.has(id),
			});
			saving = saving.then(async () => {
				if (stopped) return;
				try {
					const saved = await client.api.message.updateMessage.mutate({
						message: working.id,
						author: working.author,
						config: working.config,
						data,
						truncate: false,
					});
					if (!stopped) await MessageQueryService.write(client, saved);
				} catch (error) {
					console.warn("[ClientMessageService] could not checkpoint:", error);
				}
			});
		};

		return {
			/** Saves within the interval, unless a save is already due. */
			schedule: () => {
				if (!stopped && !timer)
					timer = setTimeout(save, CHECKPOINT_INTERVAL_MS);
			},
			/** No more saves; resolves once one under way is done. */
			stop: async () => {
				stopped = true;
				clearTimeout(timer);
				timer = undefined;
				await saving;
			},
		};
	},

	/** End a reply on the error that stopped it, dropping calls left half-written. */
	_abort: (data: zData, error: unknown) => {
		if (!data.length) data.push([]);
		const parts = data[data.length - 1];
		parts.splice(
			0,
			parts.length,
			...parts.filter((part) => !(part.type === "toolCall" && part.partial)),
		);
		parts.push({
			id: CommonUtils.getRandomId(),
			type: "abort",
			reason:
				error instanceof Error && error.name === "AbortError"
					? "user"
					: "error",
			message: error instanceof Error ? error.message : String(error),
			details: CommonUtils.formatError({ error, details: true }),
		});
	},

	/**
	 * The reply could not be saved as generated. The server keeps why, and the
	 * open chat keeps what was generated on top of that until it is reloaded.
	 */
	_saveFailed: async (
		client: Client,
		working: MessageState,
		error: unknown,
	): Promise<void> => {
		const failure: zData = [];
		ClientMessageService._abort(failure, error);
		const [[abort]] = failure;
		if (abort.type === "abort")
			abort.message = `This reply could not be saved: ${abort.message}`;
		try {
			await client.api.message.updateMessage.mutate({
				message: working.id,
				author: working.author,
				config: working.config,
				data: failure,
				truncate: false,
			});
		} catch (error) {
			console.error("[ClientMessageService] could not save failure:", error);
		}
		await MessageQueryService.write(client, {
			...working,
			data: [...working.data, ...failure],
		});
	},

	/** Persist the final reply state to the server. */
	_finalize: async (
		client: Client,
		response: MessageState,
		metadata: zMetadata,
	): Promise<void> => {
		console.log("[ClientMessageService] finalizing", response);
		const saved = await client.api.message.updateMessage.mutate({
			message: response.id,
			author: response.author,
			config: response.config,
			data: response.data,
			appendMetadata: metadata,
			truncate: false,
		});
		await MessageQueryService.write(client, saved);
		await ChatService.fetchChatList({ client });
		void UserService.fetchActions({ client });
		void UserService.fetchMemories({ client });
		void UserService.fetchNextEmbeddingBatch({ client });
	},
} as const;
