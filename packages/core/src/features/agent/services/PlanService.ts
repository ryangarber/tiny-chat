import type { Capabilities } from "#core/core/types/capability.ts";
import type { zAgentMessage } from "#core/features/agent/types/agent.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/** The command a message asks for a plan with. */
const COMMAND = "plan";

/**
 * A plan written before the work, asked for with `/plan`. It lives in the
 * chat's own directory on the mount, so it is a file like any other there: in
 * the chat's sources, readable by the shell tools, and kept with the chat.
 */
export const PlanService = {
	command: COMMAND,

	path: (chatId: string) =>
		PathUtils.toMount({ mount: "chat", id: chatId, path: "plan.md" }),

	/** Whether the user asked for a plan anywhere in the chat. */
	isActive: (messages: Pick<zAgentMessage, "author" | "data">[]) =>
		messages.some(
			(message) =>
				message.author === "USER" &&
				message.data
					.flat()
					.some((part) => part.type === "command" && part.name === COMMAND),
		),

	/** Whether a call's path is the chat's plan. */
	isPlan: (path: string) => {
		const parsed = PathUtils.fromMount({ path });
		return (
			parsed?.mount === "chat" &&
			parsed.rest.length === 1 &&
			parsed.rest[0] === "plan.md"
		);
	},

	/** What the message that asked for the plan tells the model, in its context. */
	getContext: ({ path, tool }: { path: string; tool: string }) =>
		`<plan path="${path}">
The user wants a plan before the work is done. Look into whatever you need first without changing anything, then write the plan to this file with \`${tool}\`: the goal, the approach and the decisions it rests on, concrete steps saying what each one changes, and how the result will be checked. Keep it short enough to skim, and put open questions in it rather than guessing at the answers. Then reply with a brief summary and stop — don't start the work until the user gives the go-ahead. Revise the plan with \`${tool}\` as they give feedback rather than restating it in your reply, and once you carry it out, keep it current by checking off steps as they are done.
</plan>`,

	/** Creates the chat's plan, empty, unless it is already there. */
	ensure: async ({
		capabilities,
		chatId,
	}: {
		capabilities: Pick<Capabilities, "chatShell">;
		chatId: string;
	}) => {
		const shell = capabilities.chatShell;
		if (!shell) return;
		const path = PlanService.path(chatId);
		// Looked up in the listing where there is one, since reading a file
		// that isn't there fails a request every time a plan is started.
		const exists = shell.nodes
			? (await shell.nodes()).some((node) => node.uri === path)
			: await shell.readFile({ path }).then(
					() => true,
					() => false,
				);
		if (!exists) await shell.writeFile({ path, content: "" });
	},
} as const;
