import { z } from "zod";
import type { Model } from "#core/core/services/PostgresService.ts";

export type ProjectState = Model["Project"] & {
	chats: ChatState[];
};

export type ProjectLike = { id: string } | string;
export const ProjectLike = z.custom<ProjectLike>();

export type ChatState = Model["Chat"] & {
	messages: Pick<Model["Message"], "createdAt" | "updatedAt">[];
	project: Pick<Model["Project"], "title" | "settings"> | null;
	/** Whether anything has happened in it since it was last caught up on. */
	unread: boolean;
};

/**
 * Something that changed among a user's chats, as their open instances hear
 * of it.
 */
export type ChatEvent =
	/** Chats were added, removed, renamed, moved, or reordered. */
	| { type: "list" }
	/** One chat was written to, or caught up on. */
	| {
			type: "chat";
			chatId: string;
			unread: boolean;
			/** Its messages changed, rather than only whether it was read. */
			messages: boolean;
			/** The instance that wrote it, if it was one. */
			origin: string | null;
	  };

export type ChatLike = { id: string } | string;
export const ChatLike = z.custom<ChatLike>();
