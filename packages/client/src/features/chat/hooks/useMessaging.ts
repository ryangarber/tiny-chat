import { useMutation } from "@tanstack/react-query";
import { useContext, useRef } from "react";
import { ClientContext } from "#client/client.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { useConfig } from "#client/features/agent/hooks/useConfig.ts";
import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import { useSkills } from "#client/features/agent/hooks/useSkills.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { ClientMessageService } from "#client/features/agent/services/ClientMessageService.ts";
import { ClientProviderService } from "#client/features/agent/services/ClientProviderService.ts";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useMessageQueueStore } from "#client/features/chat/stores/useMessageQueueStore.ts";
import { ActiveChatUtils } from "#client/features/chat/utils/ActiveChatUtils.ts";
import { AttachmentService } from "#client/features/editor/services/AttachmentService.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { MessageQueryService } from "#client/features/message/services/MessageQueryService.ts";
import { ToolFeedbackService } from "#client/features/part/services/ToolFeedbackService.ts";
import { useEmbeddingSettings } from "#client/features/settings/hooks/useEmbeddingSettings.ts";
import { ShellCommandService } from "#client/features/shell/services/ShellCommandService.ts";
import { useShellStore } from "#client/features/shell/stores/useShellStore.ts";
import { ShellCommandUtils } from "#client/features/shell/utils/ShellCommandUtils.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ChatState } from "#core/features/data/types/chat.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zData, zToolCallPart } from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { ModelProviderService } from "#core/features/provider/services/ModelProviderService.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";

export const deleteMessageMutationKey = [
	"useMessaging",
	"deleteMessage",
] as const;
export const sendMessageMutationKey = ["useMessaging", "sendMessage"] as const;
export const sendToolInputMutationKey = [
	"useMessaging",
	"sendToolFeedback",
] as const;

export const useMessaging = () => {
	const client = useContext(ClientContext);

	const { chat } = useChat();
	const { session } = useSession();
	const { mcpTools } = useTools();
	const { skills } = useSkills();
	const { providers } = useProviders();
	const { embeddingConfig } = useEmbeddingSettings();
	const { config, status: configStatus } = useConfig();

	const deletingChatId = useRef<string | undefined>(undefined);

	const deleteMessage = useMutation({
		mutationKey: deleteMessageMutationKey,
		mutationFn: async (message: MessageState) => {
			deletingChatId.current = message.chatId;
			return await client.api.message.deleteMessage.mutate(message);
		},
		onSuccess: async (chatDeleted, message) => {
			if (!deletingChatId.current) return;
			void ChatService.fetchMessages({
				client,
				chatId: deletingChatId.current,
			});
			if (chatDeleted) {
				await ChatService.fetchChatList({ client });
				if (deletingChatId.current === message.chatId)
					ChatService.setChat({ id: null });
			}
		},
	});

	const sendingData = useRef<zData | undefined>(undefined);

	const sendMessage = useMutation({
		mutationKey: sendMessageMutationKey,
		mutationFn: async () => {
			sendingData.current = undefined;
			const { mode } = useComposerStore.getState();
			const editing = mode.kind === "edit" ? mode : null;
			const insertingAfter = mode.kind === "insert" ? mode.after : null;

			const data = ComposerService.getData({ client });

			// A command, typed after a `!`, is run rather than sent; the `!` is
			// left behind for the next one.
			const command = editing
				? null
				: ShellCommandUtils.parse(useComposerStore.getState().text);
			if (command !== null) {
				// Kept as it is while there is nothing to run, or one still running.
				const { run } = useShellStore.getState();
				if (!command || (run && !run.result)) return;
				ComposerService.setData({
					client,
					data: [
						[
							{
								type: "text",
								id: CommonUtils.getRandomId(),
								value: ShellCommandUtils.PREFIX,
							},
						],
					],
				});
				void ShellCommandService.run({ client, command });
				return;
			}

			const isEmpty = !data
				.flat()
				.some((part) => part.type !== "text" || part.value.trim().length);
			// Kept as a draft until there is a model to send it to, and until
			// every attachment in it has been read.
			if (
				isEmpty ||
				configStatus !== "ready" ||
				AttachmentService.pending(data).length
			) {
				return;
			}

			if (!session.data) {
				throw new Error("missing session");
			}

			const { active } = useChatStore.getState();
			const selectedId = active.chatId;
			if (
				selectedId &&
				(useMessageQueueStore.getState().active[selectedId] ||
					useStreamStore.getState().chatAgentStreams.has(selectedId) ||
					(chat.data?.id === selectedId &&
						DataUtils.isMissingToolResult({
							data:
								(
									await MessageQueryService.ensure(
										client,
										selectedId,
										ActiveChatUtils.branches(active),
									)
								).messages.at(-1)?.data ?? [],
						})))
			) {
				useMessageQueueStore.getState().enqueue(selectedId, data);
				ComposerService.reset({ client });
				return;
			}

			sendingData.current = data;
			ComposerService.reset({ client });

			const chatId = selectedId ?? undefined;
			// A new chat keeps its options until it opens, so a failed send keeps them.
			const { temporary, incognito } = ActiveChatUtils.options(active);
			const previous =
				insertingAfter?.id ??
				(!editing && chatId
					? (
							await MessageQueryService.ensure(
								client,
								chatId,
								ActiveChatUtils.branches(active),
							)
						).messages.at(-1)?.id
					: undefined);
			const message = editing
				? await client.api.message.editMessage.mutate({
						message: editing.message.id,
						author: editing.message.author,
						config: config,
						data: data,
						truncate: editing.truncate,
					})
				: await client.api.message.createMessage.mutate({
						chat: chatId,
						projectId: chatId ? undefined : active.project?.id,
						author: "USER",
						config: config,
						data: data,
						previous,
						temporary,
						incognito,
					});

			if (
				editing &&
				!editing.truncate &&
				chatId === useChatStore.getState().active.chatId
			) {
				await MessageQueryService.write(client, message);
				await MessageQueryService.selectBranch(
					client,
					message.previousId,
					message.id,
				);
			} else {
				await MessageQueryService.write(client, message, true);
			}

			const text = DataUtils.getText(message);
			if (
				text.length &&
				(!editing ||
					text.trim() !== DataUtils.getText(editing.message).trim()) &&
				embeddingConfig
			) {
				const provider = (
					await ClientProviderService.getModelProviders({
						client,
						user: session.data.user,
					})
				).find((p) => p.name === embeddingConfig?.provider);

				if (provider) {
					console.log(`[messaging] message changed, embedding new message`);
					const embeddings = await ModelProviderService.runEmbeddingModel({
						user: session.data.user,
						provider,
						values: [text],
						config: embeddingConfig,
						env: client.providerEnv,
					});
					if (embeddings[0]?.length) {
						await client.api.embedding.setEmbeddings.mutate([
							{ type: "message", id: message.id, embedding: embeddings[0] },
						]);
						console.log(`[messaging] embeddings succeeded`);
					}
				}
			}

			let chatData: ChatState;
			if (!chatId) {
				ChatService.setChat({ id: message.chatId });
				const title = DataUtils.getTextCleaned({ data, maxLength: 100 });
				void (async () => {
					await client.api.chat.setChatTitle.mutate({
						chat: message.chatId,
						title,
					});
					await ChatService.fetchChatList({ client });
				})();
				chatData = await client.api.chat.getChat.query(message);
			} else {
				chatData = chat.data ?? (await client.api.chat.getChat.query(message));
			}

			if (!providers.data || !session.data) {
				throw new Error("missing provider or session data");
			}

			await ClientMessageService.onMessage({
				client,
				user: session.data.user,
				message,
				chat: chatData,
				providers: providers.data,
				skills,
				mcpTools: mcpTools.data ?? [],
			});
		},

		// The draft is given back to send again; the error is only logged, as
		// thrown into the tree it would take the whole app down with it.
		onError: (error) => {
			console.error("[useMessaging] could not send:", error);
			if (sendingData.current) {
				ComposerService.setData({ client, data: [...sendingData.current] });
			}
		},
	});

	const sendToolFeedback = useMutation({
		mutationKey: sendToolInputMutationKey,
		mutationFn: async ({
			seed,
			part,
			feedback,
			approved,
		}: {
			seed: MessageState;
			part: zToolCallPart;
			feedback?: unknown;
			approved?: boolean;
		}) => {
			console.log(
				"[useMessaging] applying tool feedback:",
				part,
				feedback,
				approved,
			);
			const answer = { approved, feedback };

			// A generation waiting on the call takes the answer as it goes.
			if (ToolFeedbackService.give(part.id, answer)) return;

			if (!session.data || !chat.data || !providers.data) return;

			// Otherwise it is held for one that is running, or about to, to take
			// when it gets to the call. Only once there is none does the answer
			// resume the reply itself, rather than racing them.
			const taken = ToolFeedbackService.hold(part.id, answer);
			while (true) {
				const outcome = await Promise.race([
					taken,
					ClientMessageService.idle(seed.chatId).then(() => undefined),
				]);
				// Taken, or let go of by a generation the user stopped.
				if (outcome !== undefined) return;
				// Another answer may have resumed the reply in the meantime.
				if (ClientMessageService.isIdle(seed.chatId)) break;
			}

			// A call the provider runs itself takes the answer as it resumes,
			// to tell the provider.
			if (part.validation?.approval && !approved && !part.providerExecuted) {
				ToolFeedbackService.settle(part.id);
				await ClientMessageService.onMessage({
					client,
					user: session.data.user,
					message: seed,
					chat: chat.data,
					toolResults: [
						{
							type: "toolResult",
							id: part.id,
							name: part.name,
							error: true,
							output: ToolCallUtils.getRejection(),
						},
					],
					providers: providers.data,
					skills,
					mcpTools: mcpTools.data ?? [],
				});
				return;
			}

			// The generation it resumes takes it, and any other answers while it
			// runs.
			try {
				await ClientMessageService.onMessage({
					client,
					user: session.data.user,
					message: seed,
					chat: chat.data,
					providers: providers.data,
					skills,
					mcpTools: mcpTools.data ?? [],
					toolResults: [],
					answered: true,
				});
			} catch (error) {
				ToolFeedbackService.settle(part.id);
				throw error;
			}
		},
	});

	return { deleteMessage, sendMessage, sendToolFeedback };
};
