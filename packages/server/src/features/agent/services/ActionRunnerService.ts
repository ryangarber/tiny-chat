import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { ServerAgentService } from "#server/features/agent/services/ServerAgentService.ts";
import { ChatEventService } from "#server/features/chat/services/ChatEventService.ts";
import { ChatService } from "#server/features/chat/services/ChatService.ts";
import { MessageService } from "#server/features/message/services/MessageService.ts";
import { MessageUtils } from "#server/features/message/utils/MessageUtils.ts";

let running = false;

export const ActionRunnerService = {
	next: async ({ testUserId }: { testUserId?: string } = {}) => {
		if (running) {
			console.warn(
				"[ActionRunnerService] ignoring action run because one is already running",
			);
			return;
		}

		running = true;

		try {
			const actions = await globalThis.db.orm.public.Action.include("user")
				.include("message", (m) => m.select("chatId"))
				.all();
			const cutoff = Temporal.Now.plainDateTimeISO("UTC");

			for (const action of actions) {
				if (action.message === null)
					throw new Error("TODO TEMP - prisma typing bug");
				try {
					if (
						testUserId ? action.user.id !== testUserId : action.user.isEphemeral
					) {
						continue;
					}

					const nextRunAt = CommonUtils.getScheduled({
						rrule: action,
						after: action.lastRanAt,
					});

					if (
						(!nextRunAt ||
							Temporal.PlainDateTime.compare(nextRunAt, cutoff) > 0) &&
						testUserId !== action.userId
					) {
						continue;
					}
					console.log(
						`[ActionRunnerService] starting action ${action.id} scheduled for ${nextRunAt}`,
					);

					await globalThis.db.orm.public.Action.where({
						id: action.id,
						userId: action.userId,
					}).update({
						lastRanAt: cutoff,
					});
					const user = action.user;
					const chat = await ChatService.getChat({
						user,
						chat: action.message.chatId,
					});
					const { messages } = await MessageService.getMessages({
						user,
						chat,
						start: action.messageId,
					});
					const { userMessage, modelMessage } = await globalThis.db.transaction(
						async (tx) => {
							const base = {
								userId: user.id,
								chatId: chat.id,
								config: action.config,
								metadata: [],
							};
							const userMessage = MessageUtils.toMessageState(
								await tx.orm.public.Message.create({
									...base,
									id: CommonUtils.getRandomId(),
									author: "USER",
									data: action.data,
									previousId: messages.at(-1)?.id ?? action.messageId,
								}),
							);
							const modelMessage = MessageUtils.toMessageState(
								await tx.orm.public.Message.create({
									...base,
									id: CommonUtils.getRandomId(),
									author: "MODEL",
									data: [],
									previousId: userMessage.id,
								}),
							);
							return { userMessage, modelMessage };
						},
					);
					// Nobody wrote the prompt: it is news unless the chat is open.
					await ChatEventService.activity({
						userId: user.id,
						chatId: chat.id,
						at: modelMessage.createdAt,
						list: true,
					});

					const { data, metadata } = await ServerAgentService.runAgent({
						chat,
						context: {
							user,
							chat,
							messages: [...messages, userMessage, modelMessage],
							timezone: action.timezone,
							interactive: false,
						},
						prompt: userMessage,
					});

					await globalThis.db.orm.public.Message.where({
						id: modelMessage.id,
						userId: user.id,
					}).update({
						data,
						metadata,
						updatedAt: Temporal.Now.plainDateTimeISO("UTC"),
					});
					await ChatEventService.activity({
						userId: user.id,
						chatId: chat.id,
						at: Temporal.Now.plainDateTimeISO("UTC"),
					});

					console.log(
						`[ActionRunnerService] action complete:`,
						action,
						userMessage,
						modelMessage,
					);
				} catch (error) {
					console.error(
						`[ActionRunnerService] error running action ${action.id}:`,
						error,
					);
				}
			}
		} finally {
			running = false;
		}
	},
} as const;
