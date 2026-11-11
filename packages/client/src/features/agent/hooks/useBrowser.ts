import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import {
	ClientBrowserService,
	type zBrowserSettings,
} from "#client/features/agent/services/ClientBrowserService.ts";

export const browserSettingsQueryKey = ["useBrowser", "settings"] as const;

/** The user's settings for the browser the agent drives. */
export const useBrowser = () => {
	const client = useContext(ClientContext);

	const browserSettings = useQuery({
		queryKey: browserSettingsQueryKey,
		queryFn: () => ClientBrowserService.getSettings({ client }),
		staleTime: Infinity,
	});

	const setBrowserSettings = useMutation({
		mutationFn: async (settings: zBrowserSettings) => {
			ClientBrowserService.setSettings({ client, settings });
			client.queryClient.setQueryData(browserSettingsQueryKey, settings);
		},
	});

	return { browserSettings, setBrowserSettings };
};
