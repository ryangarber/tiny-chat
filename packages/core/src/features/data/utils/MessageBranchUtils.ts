import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

/** Parent id -> selected child id; the empty key selects a root message. */
export type MessageBranches = Record<string, string>;
export type BranchMessage = {
	id: string;
	previousId: string | null;
	createdAt: Date | Temporal.PlainDateTime;
};

export const MessageBranchUtils = {
	index: <T extends BranchMessage>(messages: readonly T[]) => {
		const byId = new Map(messages.map((message) => [message.id, message]));
		const children = new Map<string | null, T[]>();
		for (const message of [...messages].sort(
			(a, b) =>
				CommonUtils.toDate(a.createdAt).getTime() -
					CommonUtils.toDate(b.createdAt).getTime() || a.id.localeCompare(b.id),
		)) {
			const siblings = children.get(message.previousId) ?? [];
			siblings.push(message);
			children.set(message.previousId, siblings);
		}
		return { byId, children };
	},

	/** Recreate the path through start, including its ancestors, then selected
	 * descendants. Unspecified (or deleted) selections follow the branch holding
	 * the latest message. */
	getBranch: <T extends BranchMessage>(
		messages: readonly T[],
		start?: string | null,
		branches: MessageBranches = {},
	): T[] => {
		const { byId, children } = MessageBranchUtils.index(messages);
		const latest = MessageBranchUtils.latest(messages, children);
		const path: T[] = [];
		const seen = new Set<string>();
		let current = start ? byId.get(start) : undefined;
		if (start && !current)
			throw new Error(`Message ${start} is not in this chat`);
		while (current) {
			if (seen.has(current.id)) throw new Error("Message cycle detected");
			seen.add(current.id);
			path.push(current);
			current = current.previousId ? byId.get(current.previousId) : undefined;
		}
		path.reverse();
		let parent = start ?? null;
		while (true) {
			const siblings = children.get(parent) ?? [];
			const next =
				siblings.find((m) => m.id === branches[parent ?? ""]) ??
				siblings.reduce<T | undefined>(
					(best, m) =>
						!best || (latest.get(m.id) ?? 0) >= (latest.get(best.id) ?? 0)
							? m
							: best,
					undefined,
				);
			if (!next) break;
			if (seen.has(next.id)) throw new Error("Message cycle detected");
			seen.add(next.id);
			path.push(next);
			parent = next.id;
		}
		return path;
	},

	/** Each message's id -> the time of the latest message in its subtree. */
	latest: <T extends BranchMessage>(
		messages: readonly T[],
		children: Map<string | null, T[]>,
	) => {
		const order: T[] = [];
		const seen = new Set<string>();
		const queue: (string | null)[] = [null];
		for (let i = 0; i < queue.length; i++) {
			for (const child of children.get(queue[i]) ?? []) {
				if (seen.has(child.id)) continue;
				seen.add(child.id);
				order.push(child);
				queue.push(child.id);
			}
		}
		const latest = new Map(
			messages.map((m) => [m.id, CommonUtils.toDate(m.createdAt).getTime()]),
		);
		for (const message of order.reverse()) {
			if (!message.previousId) continue;
			const own = latest.get(message.id) ?? 0;
			if (own > (latest.get(message.previousId) ?? 0))
				latest.set(message.previousId, own);
		}
		return latest;
	},

	/** Every descendant, in parent-before-child order, excluding start. */
	getDescendants: <T extends BranchMessage>(
		messages: readonly T[],
		start: string,
	): T[] => {
		const { children } = MessageBranchUtils.index(messages);
		const result: T[] = [];
		const queue = [start];
		const seen = new Set(queue);
		for (let i = 0; i < queue.length; i++) {
			for (const child of children.get(queue[i]) ?? []) {
				if (seen.has(child.id)) throw new Error("Message cycle detected");
				seen.add(child.id);
				queue.push(child.id);
				result.push(child);
			}
		}
		return result;
	},
} as const;
