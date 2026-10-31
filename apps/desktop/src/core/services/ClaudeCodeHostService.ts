import { ClaudeCodeRunService } from "#client/features/agent/services/ClaudeCodeRunService.ts";
import type {
	ClaudeCodeAnswer,
	ClaudeCodeQuestion,
	DesktopHandlers,
	DesktopSend,
} from "#desktop/core/types/rpc.ts";

/**
 * Claude Code, run in the main process on the user's installed `claude`. The
 * provider itself runs in the webview: events go to it as they come, and what
 * a run asks of it — running one of Tiny Chat's tools, or the user's approval
 * — goes out as a question it answers with `claudeCodeAnswer`.
 */
export const ClaudeCodeHostService = {
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<
		| "claudeCodeStatus"
		| "claudeCodeRun"
		| "claudeCodeCancel"
		| "claudeCodeSend"
		| "claudeCodeClose"
		| "claudeCodeAnswer"
	> => {
		/** Questions waiting on the webview, by id, with the run they belong to. */
		const questions = new Map<
			string,
			{ key: number; answer: (answer: ClaudeCodeAnswer) => void }
		>();

		const ask = (key: number, question: ClaudeCodeQuestion) =>
			new Promise<ClaudeCodeAnswer>((answer) => {
				const id = crypto.randomUUID();
				questions.set(id, { key, answer });
				send.claudeCodeQuestion({ key, id, ...question });
			});

		return {
			claudeCodeStatus: async () => ClaudeCodeRunService.status(),

			claudeCodeRun: async ({ key, request }) =>
				ClaudeCodeRunService.run(request, {
					onEvent: (event) => {
						send.claudeCodeEvent({ key, event });
						if (event.type !== "end") return;
						// A run that ended answers nothing more.
						for (const [id, question] of questions)
							if (question.key === key) {
								questions.delete(id);
								question.answer({ type: "none" });
							}
					},
					callTool: async (call) => {
						const answer = await ask(key, { type: "tool", ...call });
						return answer.type === "tool"
							? answer.result
							: {
									content: [{ type: "text", text: "The tool did not run." }],
									isError: true,
								};
					},
					canUseTool: async (call) => {
						const answer = await ask(key, { type: "permission", ...call });
						return answer.type === "permission"
							? answer.result
							: { allow: false, message: "The user did not answer." };
					},
				}),

			claudeCodeCancel: async ({ id }) => {
				ClaudeCodeRunService.cancel(id);
			},

			claudeCodeSend: async ({ id, prompt }) => {
				ClaudeCodeRunService.send(id, prompt);
			},

			claudeCodeClose: async ({ id }) => {
				ClaudeCodeRunService.close(id);
			},

			claudeCodeAnswer: async ({ id, answer }) => {
				questions.get(id)?.answer(answer);
				questions.delete(id);
			},
		};
	},
};
