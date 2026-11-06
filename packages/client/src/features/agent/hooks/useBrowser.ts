import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { nativeToolsQueryKey } from "#client/features/agent/hooks/useTools.ts";
import {
	browserStatusQueryKey,
	ClientBrowserService,
	type zBrowserSettings,
} from "#client/features/agent/services/ClientBrowserService.ts";

export { browserStatusQueryKey };
export const browserSettingsQueryKey = ["useBrowser", "settings"] as const;

/** What was found to drive a browser with, and how to look again. */
export const useBrowser = () => {
	const client = useContext(ClientContext);

	const browserStatus = useQuery({
		queryKey: browserStatusQueryKey,
		queryFn: () => ClientBrowserService.getStatus({ client }),
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const browserSettings = useQuery({
		queryKey: browserSettingsQueryKey,
		queryFn: () => ClientBrowserService.getSettings({ client }),
		staleTime: Infinity,
	});

	/** Restarts the driver and searches again; the toolset follows. */
	const recheckBrowser = useMutation({
		mutationFn: async () => {
			const status = await ClientBrowserService.recheck({ client });
			client.queryClient.setQueryData(browserStatusQueryKey, status);
			await client.queryClient.invalidateQueries({
				queryKey: nativeToolsQueryKey,
			});
			return status;
		},
	});

	const setBrowserSettings = useMutation({
		mutationFn: async (settings: zBrowserSettings) => {
			ClientBrowserService.setSettings({ client, settings });
			client.queryClient.setQueryData(browserSettingsQueryKey, settings);
		},
	});

	return { browserStatus, browserSettings, recheckBrowser, setBrowserSettings };
};
