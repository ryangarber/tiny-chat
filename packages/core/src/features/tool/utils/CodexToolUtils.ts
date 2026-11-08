import { askQuestionDisplay } from "#core/features/tool/tools/questions/ask_question.ts";
import type { ToolBlock } from "#core/features/tool/types/display.ts";
import {
	type AgentToolDisplay,
	type AgentToolInput,
	AgentToolUtils,
} from "#core/features/tool/utils/AgentToolUtils.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

const { make, str } = AgentToolUtils;

/** What Codex runs a command as: `zsh -lc '…'`, shown as the command. */
const command = (input: AgentToolInput) => {
	const value = str(input.command);
	const match = /^\S*(?:ba|z)?sh\s+-l?c\s+'([\s\S]*)'$/.exec(value);
	return match ? match[1].replace(/'\\''/g, "'") : value;
};

const changes = (input: AgentToolInput): AgentToolInput[] =>
	Array.isArray(input.changes) ? input.changes : [];

/**
 * One file of a patch as a diff: an update's hunks read back into the lines
 * before and after it, an added or deleted file's contents whole.
 */
const patchDiff = (change: AgentToolInput): ToolBlock => {
	const path = str(change?.path);
	const diff = str(change?.diff);
	const kind = str(change?.kind?.type);
	const before: string[] = [];
	const after: string[] = [];
	if (kind === "add") after.push(diff);
	else if (kind === "delete") before.push(diff);
	else {
		let hunk = false;
		for (const line of diff.replace(/\n$/, "").split("\n")) {
			if (line.startsWith("@@")) {
				hunk = true;
				continue;
			}
			// File headers come before the first hunk; `\ No newline` anywhere.
			if ((!hunk && /^(---|\+\+\+) /.test(line)) || line.startsWith("\\"))
				continue;
			const text = line.slice(1);
			if (line.startsWith("-")) before.push(text);
			else if (line.startsWith("+")) after.push(text);
			else {
				before.push(text);
				after.push(text);
			}
		}
	}
	return ToolDisplayUtils.diff({
		path,
		before: before.join("\n"),
		after: after.join("\n"),
	});
};

const subagents = (verb: [string, string]) =>
	make({ status: () => [verb, { count: ["subagent", "subagents"] }] });

/**
 * How Codex's own tools are shown, in the look of their Tiny Chat
 * counterparts. Their results are mostly text, which every call shows as is.
 */
const displays: Record<string, AgentToolDisplay> = {
	exec_command: AgentToolUtils.command(command),
	apply_patch: make({
		tracksChanges: true,
		status: (input) =>
			ToolDisplayUtils.status.paths({
				verb: ["Editing", "Edited"],
				paths: changes(input).map((change) => str(change?.path)),
			}),
		input: (input) => changes(input).map(patchDiff),
	}),
	web_search: make({
		status: (input) => ToolDisplayUtils.status.searchWeb(str(input.query)),
	}),
	view_image: AgentToolUtils.read((input) => str(input.path)),
	image_generation: AgentToolUtils.image({
		prompt: (input) => str(input.prompt),
	}),
	spawn_agent: AgentToolUtils.subagent({
		task: (input) => str(input.agentPath).split("/").at(-1) ?? "",
		prompt: (input) => str(input.message) || str(input.prompt),
	}),
	wait_agent: subagents(["Waiting on", "Waited on"]),
	send_message: subagents(["Messaging", "Messaged"]),
	followup_task: subagents(["Messaging", "Messaged"]),
	interrupt_agent: subagents(["Stopping", "Stopped"]),
	close_agent: subagents(["Closing", "Closed"]),
	list_agents: make({
		status: () => [
			["Listing", "Listed"],
			{ count: ["subagents", "subagents"] },
		],
	}),
	sleep: make({ status: () => [["Waiting", "Waited"]] }),
	// Answered through the user's feedback, as Tiny Chat's own questions are.
	request_user_input: askQuestionDisplay,
};

export const CodexToolUtils = {
	/** How one of Codex's own tools is shown, if it is one. */
	getDisplay: (name: string): AgentToolDisplay | undefined =>
		Object.hasOwn(displays, name) ? displays[name] : undefined,
} as const;
