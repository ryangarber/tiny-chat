import {
	type CodexChannelMessage,
	serveCodexHost,
} from "@ryangarber/ai-sdk-providers/codex";
import { CodexRunService } from "#client/features/agent/services/CodexRunService.ts";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

/**
 * Codex, run in the main process on the user's installed `codex`. The
 * provider runs in the webview and reaches it over one channel: its messages
 * come in as `codex` requests, the host's go out as `codex`.
 */
export const CodexHostService = {
	create: ({ send }: { send: DesktopSend }): DesktopHandlers<"codex"> => {
		const handlers = new Set<(message: CodexChannelMessage) => void>();
		serveCodexHost(CodexRunService, {
			post: (message) => send.codex(message),
			listen: (handler) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
		});
		return {
			codex: async (message) => {
				for (const handler of handlers) handler(message);
			},
		};
	},
};
