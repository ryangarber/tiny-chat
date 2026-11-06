import { createLocalHost } from "@ryangarber/ai-sdk-providers/codex/local";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";

/**
 * Codex on the user's installed `codex` and its own sign-in, in this process:
 * the CLI's own, the desktop app's main process. Node and Bun only. Its
 * environment is the user's login shell, so `codex` finds what their
 * terminal would.
 */
export const CodexRunService = createLocalHost({
	env: () => NodeShellService.env({ login: true }),
	clientInfo: { name: "tiny_chat", title: "Tiny Chat", version: "1" },
});
