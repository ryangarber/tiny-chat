import {
	type ClaudeCodeChannelMessage,
	serveClaudeCodeHost,
} from "@ryangarber/ai-sdk-providers/claude";
import { ClaudeCodeRunService } from "#client/features/agent/services/ClaudeCodeRunService.ts";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

/**
 * Claude Code, run in the main process on the user's installed `claude`. The
 * provider runs in the webview and reaches it over one channel: its messages
 * come in as `claudeCode` requests, the host's go out as `claudeCode`.
 */
export const ClaudeCodeHostService = {
	create: ({ send }: { send: DesktopSend }): DesktopHandlers<"claudeCode"> => {
		const handlers = new Set<(message: ClaudeCodeChannelMessage) => void>();
		serveClaudeCodeHost(ClaudeCodeRunService, {
			post: (message) => send.claudeCode(message),
			listen: (handler) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
		});
		return {
			claudeCode: async (message) => {
				for (const handler of handlers) handler(message);
			},
		};
	},
};
