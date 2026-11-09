import { create } from "zustand";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { TypeUtils } from "#core/core/utils/TypeUtils.ts";
import type {
	zData,
	zDataSimplePart,
	zInterjectionPart,
} from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { EditorPartUtils } from "#core/features/data/utils/EditorPartUtils.ts";

interface MessageQueueStore {
	active: Record<string, boolean>;
	setActive: (chatId: string, active: boolean) => void;
	/** Chats whose reply has stopped on calls only the user can answer. */
	paused: Record<string, boolean>;
	pause: (chatId: string) => void;
	queues: Record<string, zInterjectionPart[]>;
	enqueue: (chatId: string, data: zData) => void;
	drain: (chatId: string) => zInterjectionPart[];
	/** Takes one message out of the queue, to send it some other way. */
	take: (chatId: string, id: string) => zInterjectionPart | undefined;
	/** Puts messages back at the head of the queue, as they were. */
	restore: (chatId: string, parts: zInterjectionPart[]) => void;
	remove: (chatId: string, id: string) => void;
	clear: (chatId: string) => void;
	finish: (chatId: string, data: zData, failed?: boolean) => void;
}
export const useMessageQueueStore = create<MessageQueueStore>((set, get) => ({
	finish: (chatId, data, failed = false) => {
		if (
			failed ||
			!DataUtils.isMissingToolResult({ data }) ||
			// Only the latest step counts: a reply that was continued keeps the
			// abort it stopped on.
			data.at(-1)?.some((part) => part.type === "abort")
		) {
			get().clear(chatId);
			get().setActive(chatId, false);
		} else {
			get().pause(chatId);
		}
	},
	active: {},
	setActive: (chatId, active) =>
		set((state) => ({
			active: { ...state.active, [chatId]: active },
			paused: { ...state.paused, [chatId]: false },
		})),
	paused: {},
	pause: (chatId) =>
		set((state) => ({ paused: { ...state.paused, [chatId]: true } })),
	queues: {},
	enqueue: (chatId, data) => {
		const value = data.flat().flatMap((part): zDataSimplePart[] => {
			if (part.type === "interjection") return part.value;
			if (
				part.type === "text" ||
				part.type === "json" ||
				part.type === "file" ||
				part.type === "attachment"
			) {
				return [part];
			}
			// An interjection only carries the simple parts, so the ones that
			// are not go in as the Markdown they read as.
			if (EditorPartUtils.is(part)) {
				return [
					{
						id: part.id,
						type: "text",
						value: EditorPartUtils.toText(part),
					},
				];
			}
			return [];
		});
		if (!value.length) return;
		const part: zInterjectionPart = {
			id: CommonUtils.getRandomId(),
			type: "interjection",
			value: TypeUtils.deepClone(value),
		};
		set((state) => ({
			queues: {
				...state.queues,
				[chatId]: [...(state.queues[chatId] ?? []), part],
			},
		}));
	},
	drain: (chatId) => {
		const parts = get().queues[chatId] ?? [];
		get().clear(chatId);
		return parts;
	},
	take: (chatId, id) => {
		const part = get().queues[chatId]?.find((part) => part.id === id);
		if (part) get().remove(chatId, id);
		return part;
	},
	restore: (chatId, parts) => {
		if (!parts.length) return;
		set((state) => {
			const queued = state.queues[chatId] ?? [];
			const ids = new Set(queued.map((part) => part.id));
			return {
				queues: {
					...state.queues,
					[chatId]: [...parts.filter((part) => !ids.has(part.id)), ...queued],
				},
			};
		});
	},
	remove: (chatId, id) =>
		set((state) => ({
			queues: {
				...state.queues,
				[chatId]: (state.queues[chatId] ?? []).filter((part) => part.id !== id),
			},
		})),
	clear: (chatId) =>
		set((state) => {
			const queues = { ...state.queues };
			delete queues[chatId];
			return { queues };
		}),
}));
