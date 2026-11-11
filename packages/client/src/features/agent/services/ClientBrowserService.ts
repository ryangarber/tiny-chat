import { z } from "zod";
import type { Client } from "#client/client.ts";

export const zBrowserSettings = z.object({
	/** Show the browser window rather than run it headless. */
	headed: z.boolean().default(false),
});
export type zBrowserSettings = z.infer<typeof zBrowserSettings>;

const SETTINGS_KEY = "browser";

/** The user's settings for the browser the agent drives. */
export const ClientBrowserService = {
	/** Local to this machine, so kept in the runtime's storage, not on the user. */
	getSettings: ({ client }: { client: Client }): zBrowserSettings => {
		const parsed = zBrowserSettings.safeParse(
			client.getStorage(SETTINGS_KEY) ?? {},
		);
		return parsed.success ? parsed.data : zBrowserSettings.parse({});
	},

	setSettings: ({
		client,
		settings,
	}: {
		client: Client;
		settings: zBrowserSettings;
	}) => {
		client.setStorage(SETTINGS_KEY, settings);
	},
} as const;
