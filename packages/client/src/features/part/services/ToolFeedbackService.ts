import { useToolFeedbackStore } from "#client/features/part/stores/useToolFeedbackStore.ts";
import type { zToolCallPart } from "#core/features/data/types/part.ts";
import type { ToolFeedback } from "#core/features/tool/types/tool.ts";

/** Resolvers of the answers live generations are waiting on, by call id. */
const waiters = new Map<string, (answer: ToolFeedback) => void>();
/**
 * Answers given ahead of the generation that will ask for them, with whether
 * one took it.
 */
const answers = new Map<
	string,
	{ answer: ToolFeedback; taken: (taken: boolean) => void }
>();

/**
 * Hands the user's answers to tool calls to the generation that runs them.
 * A generation still running when the user answers takes the answer at once;
 * otherwise it is held for the generation the answer resumes.
 */
export const ToolFeedbackService = {
	/** The generation's side: resolves with the call's answer once given. */
	wait: ({
		part,
		signal,
		chatId,
	}: {
		part: zToolCallPart;
		signal: AbortSignal;
		/** The chat the generation is in: none for a subagent's. */
		chatId: string | null;
	}): Promise<ToolFeedback> => {
		const given = answers.get(part.id);
		if (given) {
			answers.delete(part.id);
			given.taken(true);
			return Promise.resolve(given.answer);
		}
		if (signal.aborted) return Promise.reject(signal.reason);
		return new Promise((resolve, reject) => {
			const settle = (answer: ToolFeedback) => {
				signal.removeEventListener("abort", onAbort);
				resolve(answer);
			};
			const onAbort = () => {
				if (waiters.get(part.id) === settle) {
					waiters.delete(part.id);
					useToolFeedbackStore.getState().setAwaiting(part.id, false);
				}
				reject(signal.reason);
			};
			waiters.set(part.id, settle);
			useToolFeedbackStore.getState().setAwaiting(part.id, chatId);
			signal.addEventListener("abort", onAbort, { once: true });
		});
	},

	/**
	 * Answers a call a live generation is waiting on. False if none is, and
	 * the answer has to resume one.
	 */
	give: (id: string, answer: ToolFeedback): boolean => {
		const waiter = waiters.get(id);
		if (!waiter) return false;
		waiters.delete(id);
		const store = useToolFeedbackStore.getState();
		store.setAwaiting(id, false);
		store.setAnswered(id, true);
		waiter(answer);
		return true;
	},

	/**
	 * Holds an answer for the next generation to ask for it. Resolves true once
	 * one takes it, or false if it is let go of first.
	 */
	hold: (id: string, answer: ToolFeedback): Promise<boolean> => {
		answers.get(id)?.taken(false);
		useToolFeedbackStore.getState().setAnswered(id, true);
		return new Promise((resolve) => {
			answers.set(id, { answer, taken: resolve });
		});
	},

	/** Whether an answer is held, waiting on a generation to take it. */
	isHeld: (id: string) => answers.has(id),

	/** Forgets a call's answer once it has a result, or will not get one. */
	settle: (id: string) => {
		answers.get(id)?.taken(false);
		answers.delete(id);
		useToolFeedbackStore.getState().setAnswered(id, false);
	},
} as const;
