import {
	type CursorChannelMessage,
	serveCursorHost,
} from "@ryangarber/ai-sdk-providers/cursor";
import { CursorRunService } from "#client/features/agent/services/CursorRunService.ts";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

/**
 * Cursor's SDK and saved sign-in, running in the main process. The
 * provider runs in the webview and reaches it over one channel: its messages
 * come in as `cursor` requests, the host's go out as `cursor`.
 */
export const CursorHostService = {
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<"cursor" | "cursorSignIn"> => {
		const handlers = new Set<(message: CursorChannelMessage) => void>();
		serveCursorHost(CursorRunService, {
			post: (message) => send.cursor(message),
			listen: (handler) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
		});
		return {
			cursorSignIn: () => CursorRunService.signIn(),
			cursor: async (message) => {
				for (const handler of handlers) handler(message);
			},
		};
	},
};
