import type { Enum, Model } from "#core/core/services/PostgresService.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { ChatLike } from "#core/features/data/types/chat.ts";
import type {
	MessageLike,
	zConfig,
} from "#core/features/data/types/message.ts";
import type { zData, zMetadata } from "#core/features/data/types/part.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import {
	type MessageBranches,
	MessageBranchUtils,
} from "#core/features/data/utils/MessageBranchUtils.ts";
import { MemoryRetrievalService } from "#server/features/chat/services/MemoryRetrievalService.ts";
import { MessageUtils } from "#server/features/message/utils/MessageUtils.ts";

type Content = {
	author: Enum["Author"];
	config: zConfig;
	data: zData;
	/** What providers reported for the generations behind `data`. */
	metadata?: zMetadata;
};

const requireRow = <T>(row: T | null | undefined): T => {
	if (!row) throw new Error("missing message or chat");
	return row;
};

export const MessageService = {
	getMessage: async ({
		user,
		message,
	}: {
		user: zUser;
		message: MessageLike;
	}) => {
		if (typeof message === "string") message = { id: message };

		return MessageUtils.toMessageState(
			requireRow(
				await globalThis.db.orm.public.Message.where({
					userId: user.id,
					id: message.id,
				})
					.select(...MessageUtils.columns)
					.first(),
			),
		);
	},

	/**
	 * Where a message lives: its chat, and the branch selections that put it on
	 * the path `getMessages` returns.
	 */
	locateMessage: async ({
		user,
		message,
	}: {
		user: zUser;
		message: MessageLike;
	}) => {
		const { chatId } = await MessageService.getMessage({ user, message });
		const id = typeof message === "string" ? message : message.id;
		const topology = await globalThis.db.orm.public.Message.where({
			chatId,
			userId: user.id,
		})
			.select("id", "previousId")
			.all();
		const byId = new Map(topology.map((m) => [m.id, m]));
		const branches: MessageBranches = {};
		let current = byId.get(id);
		while (current) {
			if (branches[current.previousId ?? ""])
				throw new Error("Message cycle detected");
			branches[current.previousId ?? ""] = current.id;
			current = current.previousId ? byId.get(current.previousId) : undefined;
		}
		return { chatId, branches };
	},

	/**
	 * The whole selected branch of a chat, with the sibling options at each
	 * message. Given `after`, only the part of the branch past that message is
	 * read, for a caller that already holds everything up to it.
	 */
	getMessages: async ({
		user,
		chat,
		start,
		after,
		branches = {},
	}: {
		user: zUser;
		chat: ChatLike;
		start?: string;
		after?: string | null;
		branches?: MessageBranches;
	}) => {
		if (typeof chat === "string") chat = { id: chat };

		const query = globalThis.db.orm.public.Message.where({
			chatId: chat.id,
			userId: user.id,
		});
		const topology = (
			await query.select("id", "previousId", "createdAt").all()
		).map((m) => ({ ...m, createdAt: CommonUtils.toDate(m.createdAt) }));
		const path = MessageBranchUtils.getBranch(topology, start, branches);
		// A branch point the path no longer runs through is answered with the
		// whole path, which the caller tells apart by where it begins.
		const from = after ? path.findIndex((m) => m.id === after) + 1 : 0;
		const page = path.slice(from);
		const siblings = MessageBranchUtils.index(topology).children;
		const branchOptions = Object.fromEntries(
			page.map((m) => [
				m.id,
				(siblings.get(m.previousId) ?? []).map((s) => s.id),
			]),
		);
		if (!page.length) return { messages: [], branchOptions };
		const rows = await query
			.where((m) => m.id.in(page.map((m) => m.id)))
			.select(...MessageUtils.columns)
			.all();
		const byId = new Map(
			MessageUtils.toMessageStates(rows).map((m) => [m.id, m]),
		);
		return {
			messages: page.map((m) => requireRow(byId.get(m.id) ?? null)),
			branchOptions,
		};
	},

	/** Add a child without moving any of the parent's existing branches. */
	createMessage: async ({
		user,
		chat,
		projectId,
		previous,
		temporary,
		incognito,
		...content
	}: Content & {
		user: zUser;
		chat?: ChatLike | null;
		projectId?: string | null;
		previous?: MessageLike | null;
		temporary?: boolean;
		incognito?: boolean;
	}) => {
		if (typeof chat === "string") chat = { id: chat };
		if (typeof previous === "string") previous = { id: previous };

		// An existing chat owns its project and privacy settings. Callers only
		// supply these options when creating a new chat.
		const existingChat = chat?.id
			? requireRow(
					await globalThis.db.orm.public.Chat.where({
						id: chat.id,
						userId: user.id,
					})
						.select("incognito")
						.include("project", (project) => project.select("settings"))
						.first(),
				)
			: undefined;
		let project: Pick<Model["Project"], "settings"> | null | undefined =
			existingChat?.project;
		if (!existingChat && projectId)
			project = requireRow(
				await globalThis.db.orm.public.Project.where({
					id: projectId,
					userId: user.id,
				})
					.select("settings")
					.first(),
			);

		const retrieval = !(existingChat?.incognito ?? incognito)
			? await MemoryRetrievalService.build({
					user,
					text: DataUtils.getText(content),
					tokens: SettingsUtils.of(user, project).memoryBudget,
					more: false,
				})
			: { memories: [], embedding: undefined };

		let chatId = chat?.id ?? null;
		let previousId = previous?.id ?? null;

		return await globalThis.db.transaction(async (tx) => {
			if (chat?.id) {
				const existing = requireRow(
					await tx.orm.public.Chat.where({
						id: chat.id,
						userId: user.id,
					}).first(),
				);
				if (temporary && !existing.temporary)
					throw new Error("Chat cannot be made temporary");
				if (incognito && !existing.incognito)
					throw new Error("Chat cannot be made incognito");
				if (previousId) {
					requireRow(
						await tx.orm.public.Message.where({
							id: previousId,
							chatId: chat.id,
							userId: user.id,
						})
							.select("id")
							.first(),
					);
				} else {
					const rows = await tx.orm.public.Message.where({
						chatId: chat.id,
						userId: user.id,
					})
						.select("id", "previousId", "createdAt")
						.all();
					previousId =
						MessageBranchUtils.getBranch(
							rows.map((m) => ({
								...m,
								createdAt: CommonUtils.toDate(m.createdAt),
							})),
						).at(-1)?.id ?? null;
				}
			} else {
				if (previousId) throw new Error("A parent requires a chat");

				chatId = CommonUtils.getRandomId();

				await tx.orm.public.Chat.create({
					id: chatId,
					userId: user.id,
					projectId: projectId ?? null,
					title: null,
					temporary: temporary ?? false,
					incognito: incognito ?? false,
				});
			}
			const created = await tx.orm.public.Message.select(
				...MessageUtils.columns,
			).create({
				...content,
				metadata: content.metadata ?? [],
				id: CommonUtils.getRandomId(),
				userId: user.id,
				chatId: chatId ?? undefined,
				previousId,
				context: (context) =>
					context.connect(retrieval.memories.map((m) => ({ id: m.id }))),
			});
			if (retrieval.embedding) {
				await tx.orm.public.Message.where({
					id: created.id,
					userId: user.id,
				}).updateAndCount({ embedding: retrieval.embedding });
			}
			return MessageUtils.toMessageState(created);
		});
	},

	/** An edit is a sibling. Retaining newer messages clones the entire subtree. */
	editMessage: async ({
		user,
		message,
		truncate = false,
		...content
	}: Content & {
		user: zUser;
		message: MessageLike;
		truncate?: boolean;
	}) => {
		if (typeof message === "string") message = { id: message };

		const existing = requireRow(
			await globalThis.db.orm.public.Message.where({
				id: message.id,
				userId: user.id,
			})
				.select("id", "chatId", "previousId")
				.include("chat", (chat) =>
					chat
						.select("incognito")
						.include("project", (project) => project.select("settings")),
				)
				.first(),
		);

		const retrieval = !existing.chat?.incognito
			? await MemoryRetrievalService.build({
					user,
					text: DataUtils.getText(content),
					tokens: SettingsUtils.of(user, existing.chat?.project).memoryBudget,
					more: false,
				})
			: { memories: [], embedding: undefined };

		return await globalThis.db.transaction(async (tx) => {
			const edited = await tx.orm.public.Message.select(
				...MessageUtils.columns,
			).create({
				...content,
				metadata: content.metadata ?? [],
				id: CommonUtils.getRandomId(),
				userId: user.id,
				chatId: existing.chatId,
				previousId: existing.previousId,
				context: (context) =>
					context.connect(retrieval.memories.map((m) => ({ id: m.id }))),
			});
			if (!truncate) {
				const query = tx.orm.public.Message.where({
					chatId: existing.chatId,
					userId: user.id,
				});
				const topology = await query
					.select("id", "previousId", "createdAt")
					.all();
				const descendants = MessageBranchUtils.getDescendants(
					topology.map((m) => ({
						...m,
						createdAt: CommonUtils.toDate(m.createdAt),
					})),
					existing.id,
				);
				const rows = descendants.length
					? await query
							.where((m) => m.id.in(descendants.map((m) => m.id)))
							.include("subagents", (subagent) => subagent.select("id"))
							.all()
					: [];
				const rawById = new Map(rows.map((m) => [m.id, m]));
				const cloneIds = descendants
					.map(() => CommonUtils.getRandomId())
					.sort((a, b) => a.localeCompare(b));
				const ids = new Map([
					[existing.id, edited.id],
					...descendants.map((m, i) => [m.id, cloneIds[i]] as const),
				]);
				if (descendants.length)
					await tx.orm.public.Message.createAll(
						descendants.map((m) => {
							const { subagents: _, ...row } = requireRow(rawById.get(m.id));
							return {
								...row,
								id: requireRow(ids.get(m.id)),
								previousId: requireRow(ids.get(requireRow(m.previousId))),
							};
						}),
					);
				// A clone keeps the subagent runs its calls made.
				for (const { id, subagents } of rows) {
					if (!subagents.length) continue;
					await tx.orm.public.Message.where({
						id: requireRow(ids.get(id)),
						userId: user.id,
					}).update({
						subagents: (subagent) =>
							subagent.connect(subagents.map(({ id }) => ({ id }))),
					});
				}
			}
			return MessageUtils.toMessageState(edited);
		});
	},

	/**
	 * In-place writes are reserved for generation/feedback, never user edits.
	 * `metadata` replaces what is stored; `appendMetadata` adds a generation's
	 * to it without the caller ever having to read it back.
	 */
	updateMessage: async ({
		user,
		message,
		truncate: _truncate,
		appendMetadata,
		metadata,
		...content
	}: Content & {
		user: zUser;
		message: MessageLike;
		truncate?: boolean;
		appendMetadata?: zMetadata;
	}) => {
		if (typeof message === "string") message = { id: message };

		const query = globalThis.db.orm.public.Message.where({
			id: message.id,
			userId: user.id,
		});
		const existing = requireRow(await query.select("data").first());
		const stored = appendMetadata?.length
			? requireRow(await query.select("metadata").first()).metadata
			: undefined;
		const updated = requireRow(
			await query.select(...MessageUtils.columns).update({
				...content,
				...(stored
					? { metadata: [...(metadata ?? stored), ...(appendMetadata ?? [])] }
					: metadata
						? { metadata }
						: {}),
				updatedAt: Temporal.Now.plainDateTimeISO("UTC"),
				...(DataUtils.getText(existing) !== DataUtils.getText(content)
					? { embedding: null }
					: {}),
			}),
		);
		return MessageUtils.toMessageState(updated);
	},

	/** Delete only this turn. Shared prompts and sibling branches survive. */
	deleteMessage: async ({
		user,
		message,
	}: {
		user: zUser;
		message: MessageLike;
	}) => {
		if (typeof message === "string") message = { id: message };

		return await globalThis.db.transaction(async (tx) => {
			const existing = requireRow(
				await tx.orm.public.Message.where({
					id: message.id,
					userId: user.id,
				}).first(),
			);
			const rows = await tx.orm.public.Message.where({
				chatId: existing.chatId,
				userId: user.id,
			})
				.select("id", "previousId", "author")
				.all();
			const deleted = new Set([existing.id]);
			let parentId = existing.previousId;
			if (existing.author === "MODEL" && parentId) {
				const parent = rows.find((m) => m.id === parentId);
				if (
					parent?.author === "USER" &&
					rows.filter((m) => m.previousId === parentId).length === 1
				) {
					deleted.add(parent.id);
					parentId = parent.previousId;
				}
			} else if (existing.author === "USER") {
				for (const child of rows.filter(
					(m) => m.previousId === existing.id && m.author === "MODEL",
				))
					deleted.add(child.id);
			}
			await tx.orm.public.Message.where({
				userId: user.id,
				chatId: existing.chatId,
			})
				.where((m) => m.previousId.in([...deleted]))
				.updateAll({ previousId: parentId });

			// TODO - confirm relations delete and remove this
			await tx.orm.public.DreamMessage.where((link) =>
				link.messageId.in([...deleted]),
			).deleteAll();
			await tx.orm.public.MessageContext.where((link) =>
				link.messageId.in([...deleted]),
			).deleteAll();

			await tx.orm.public.Message.where({
				userId: user.id,
				chatId: existing.chatId,
			})
				.where((m) => m.id.in([...deleted]))
				.deleteAll();
			if (rows.length === deleted.size) {
				await tx.orm.public.Chat.where({
					id: existing.chatId,
					userId: user.id,
				}).delete();
				return true;
			}
			return false;
		});
	},
} as const;
