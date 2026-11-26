import { EventEmitter, on } from "node:events";
import type { ChatEvent } from "#core/features/data/types/chat.ts";
import { ChatUtils } from "#core/features/data/utils/ChatUtils.ts";

/**
 * What changes among a user's chats, told to each of their open instances as
 * it happens, and which chats those instances have open. A chat written to
 * while one of them has it open is caught up on there and then, so it never
 * reads as unread anywhere else; otherwise it stays unread until it is opened.
 *
 * Held in this process: instances connected to another server process hear
 * nothing of the writes made here until they next read the list.
 */
const emitter = new EventEmitter().setMaxListeners(0);

/** By user, how many open instances are on each chat. */
const viewers = new Map<string, Map<string, number>>();

const toPlain = (ms: number) =>
	Temporal.Instant.fromEpochMilliseconds(ms)
		.toZonedDateTimeISO("UTC")
		.toPlainDateTime();

const emit = (userId: string, event: ChatEvent) => {
	emitter.emit(userId, event);
};

export const ChatEventService = {
	/** Every event for `userId` until `signal` aborts. */
	listen: async function* (
		userId: string,
		signal?: AbortSignal,
	): AsyncGenerator<ChatEvent> {
		for await (const [event] of on(emitter, userId, { signal }))
			yield event as ChatEvent;
	},

	/**
	 * Counts an instance as having `chatId` open, catching it up on the chat,
	 * until the returned release is called.
	 */
	view: async (userId: string, chatId: string) => {
		const chats = viewers.get(userId) ?? new Map<string, number>();
		viewers.set(userId, chats);
		chats.set(chatId, (chats.get(chatId) ?? 0) + 1);
		await ChatEventService.read({ userId, chatId });
		return () => {
			const count = (chats.get(chatId) ?? 1) - 1;
			if (count > 0) chats.set(chatId, count);
			else chats.delete(chatId);
			if (!chats.size) viewers.delete(userId);
		};
	},

	viewed: (userId: string, chatId: string) =>
		!!viewers.get(userId)?.get(chatId),

	/** The chats changed in a way only reading the list again shows. */
	list: (userId: string) => emit(userId, { type: "list" }),

	/**
	 * Marks the chat caught up on as of now, or of `at` (its last activity, in
	 * epoch ms) should the clock that wrote that be ahead, and says so.
	 */
	read: async ({
		userId,
		chatId,
		at,
	}: {
		userId: string;
		chatId: string;
		at?: number;
	}) => {
		if (at === undefined) {
			const chat = await globalThis.db.orm.public.Chat.where({
				id: chatId,
				userId,
			})
				.select("createdAt")
				.include("messages", (message) =>
					message.select("createdAt", "updatedAt"),
				)
				.first();
			if (!chat) return;
			at = ChatUtils.getActivity(chat);
		}
		await globalThis.db.orm.public.Chat.where({ id: chatId, userId }).update({
			readAt: toPlain(Math.max(Date.now(), at)),
		});
		emit(userId, {
			type: "chat",
			chatId,
			unread: false,
			messages: false,
			origin: null,
		});
	},

	/**
	 * Something was written in the chat at `at`: it is read if the user did it
	 * themselves (`read`) or has it open somewhere, and unread otherwise.
	 * Never throws, so a write it follows is never failed by it.
	 */
	activity: async ({
		userId,
		chatId,
		at,
		origin = null,
		read = false,
		list = false,
	}: {
		userId: string;
		chatId: string;
		at: Temporal.PlainDateTime | null | undefined;
		origin?: string | null;
		read?: boolean;
		/** The write also moves the chat in the list, or adds it. */
		list?: boolean;
	}) => {
		try {
			const ms = at ? at.toZonedDateTime("UTC").epochMilliseconds : Date.now();
			const unread = !read && !ChatEventService.viewed(userId, chatId);
			if (!unread)
				await globalThis.db.orm.public.Chat.where({
					id: chatId,
					userId,
				}).update({ readAt: toPlain(Math.max(Date.now(), ms)) });
			emit(userId, {
				type: "chat",
				chatId,
				unread,
				messages: true,
				origin,
			});
			if (list) ChatEventService.list(userId);
		} catch (error) {
			console.error("[ChatEventService] could not publish activity:", error);
		}
	},
} as const;
