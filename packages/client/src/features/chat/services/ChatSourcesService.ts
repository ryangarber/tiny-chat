import type { Client } from "#client/client.ts";
import { useChatSourcesStore } from "#client/features/chat/stores/useChatSourcesStore.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { PlanService } from "#core/features/agent/services/PlanService.ts";

export const ChatSourcesService = {
	/**
	 * Brings the chat's sources up to date with its plan, just written: the
	 * file list and any preview of it are read again, and with `open` the plan
	 * is opened in them — if the chat is still the one in front of the user.
	 */
	showPlan: async ({
		client,
		chatId,
		open,
	}: {
		client: Client;
		chatId: string;
		open: boolean;
	}) => {
		const path = PlanService.path(chatId);
		await Promise.all([
			client.queryClient.invalidateQueries({ queryKey: ["useChatFiles"] }),
			client.queryClient.invalidateQueries({
				queryKey: ["useFileViewer", "data", path],
			}),
		]);
		if (open && useChatStore.getState().active.chatId === chatId)
			useChatSourcesStore
				.getState()
				.viewFile({ path, directory: false, chatId });
	},
} as const;
