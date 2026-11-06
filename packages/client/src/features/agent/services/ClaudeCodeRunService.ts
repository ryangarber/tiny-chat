import { createLocalHost } from "@ryangarber/ai-sdk-providers/claude/local";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";

/**
 * Claude Code on the user's installed `claude` and its own sign-in, in this
 * process: the CLI's own, the desktop app's main process. Node and Bun only.
 * What its calls change is found by the agent loop, as for any call.
 */
export const ClaudeCodeRunService = createLocalHost({
	/** The user's login shell, so `claude` finds what their terminal would. */
	env: () => NodeShellService.env({ login: true }),
});
