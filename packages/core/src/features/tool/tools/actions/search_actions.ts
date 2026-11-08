import { z } from "zod";
import type { ActionsCapability } from "#core/core/types/capability.ts";
import { zId } from "#core/core/types/common.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SnippetService } from "#core/features/data/services/SnippetService.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import type { ToolDisplay } from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";
import { ToolDisplayUtils } from "#core/features/tool/utils/ToolDisplayUtils.ts";

export const search_actions = {
	name: "search_actions",
	description:
		"Find scheduled actions by their prompt, best matches first. Leave out the query to list them all.",
	input: z.object({
		query: z
			.string()
			.optional()
			.describe("Keywords to match against each action's prompt."),
	}),
	output: z.object({
		id: zId,
		chat_id: zId,
		prompt: z.string(),
		created_at: z.date(),
		next_run_at: z.date().nullable(),
	}),
} as const satisfies ToolDefinition;

const display: ToolDisplay<typeof search_actions> = {
	status: ({ input }) =>
		input.query
			? [
					["Searching actions for", "Searched actions for"],
					{ count: ["query", "queries"], subject: input.query },
				]
			: [["Listing", "Listed"], { count: ["actions", "action lists"] }],
	output: ({ output }) =>
		output.map((action) => ({
			type: "record",
			title: action.prompt,
			chat: action.chat_id,
			details: [
				`Created ${ToolDisplayUtils.date(action.created_at)}`,
				...(action.next_run_at
					? [`Next runs ${ToolDisplayUtils.date(action.next_run_at)}`]
					: []),
			],
		})),
};

export const createSearchActionsTool: ToolFactory<
	Tool<typeof search_actions, { actions: ActionsCapability }>
> = (options) => ({
	...search_actions,
	...options,
	display,
	execute: async ({ input }) => {
		const actions = (await options.capabilities.actions.getActions()).map(
			(action) => ({
				id: action.id,
				chat_id: action.chatId,
				prompt: DataUtils.getText(action),
				created_at: CommonUtils.toDate(action.createdAt),
				next_run_at: CommonUtils.toDate(action.nextRunAt),
			}),
		);

		const query = input.query?.trim();
		const matches = query
			? actions
					.map((action) => ({
						action,
						score: SnippetService.getScore({ text: action.prompt, query }),
					}))
					.filter(({ score }) => score.terms > 0)
					.sort((a, b) => b.score.score - a.score.score)
					.map(({ action }) => action)
			: actions;

		return [
			...matches.map((value) => ({ type: "json" as const, value })),
			...(query && !matches.length
				? [
						{
							type: "text" as const,
							value: `No action matched (${actions.length} in all). Leave out the query to list them.`,
						},
					]
				: []),
		];
	},
});
