import { Cursor } from "@cursor/sdk";
import { createLocalHost } from "@ryangarber/ai-sdk-providers/cursor/local";

/** Cursor's SDK and saved credentials stay in the local Node/Bun host. */
export const CursorRunService = {
	...createLocalHost(),
	async signIn() {
		// The SDK opens the browser, waits for login, and saves the minted key.
		// Never return credentials across the desktop RPC boundary.
		await Cursor.auth.login({ apiKeyName: "Tiny Chat" });
	},
} as const;
