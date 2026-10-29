import { useMutation, useQueries } from "@tanstack/react-query";
import { useContext, useEffect } from "react";
import { ClientContext } from "#client/client.ts";
import { ClientMcpService } from "#client/features/agent/services/ClientMcpService.ts";
import { useMcpLogStore } from "#client/features/agent/stores/useMcpLogStore.ts";
import { useMcpStore } from "#client/features/agent/stores/useMcpStore.ts";
import { useMcpServerSettings } from "#client/features/settings/hooks/useMcpServerSettings.ts";

export type { McpServer } from "#client/features/agent/services/ClientMcpService.ts";

export const mcpServerQueryKey = ["useMcp", "mcpServer"] as const;
export const disconnectMcpServersQueryKey = [
	"useMcp",
	"disconnectMcpServers",
] as const;

export const useMcp = () => {
	const client = useContext(ClientContext);

	const { mcpServerSettings } = useMcpServerSettings();
	const setConnectedServer = useMcpStore((state) => state.setConnectedServer);

	const names = Object.keys(mcpServerSettings ?? {});

	const mcpServers = useQueries({
		queries: Object.entries(mcpServerSettings ?? {}).map(([name, server]) => ({
			queryKey: [
				...mcpServerQueryKey,
				name,
				ClientMcpService.getServerKey({ server }),
			],
			queryFn: async () => {
				const previous = useMcpStore.getState().connectedServers[name];

				const mcpServer = await ClientMcpService.connect({
					client,
					name,
					server,
				});

				// swap to prevent mcp server disconnects
				setConnectedServer(name, mcpServer.error ? null : mcpServer.client);
				if (previous) await ClientMcpService.disconnect({ client: previous });

				return mcpServer;
			},
			staleTime: Infinity,
			refetchOnReconnect: false,
			refetchOnWindowFocus: false,
		})),
		combine: (results) => ({
			data: results.flatMap((result) => (result.data ? [result.data] : [])),
			isPending: results.some((result) => result.isPending),
			isFetching: results.some((result) => result.isFetching),
		}),
	});

	/**
	 * Reconnect a single server, or every server when no name is given.
	 */
	const refreshMcpServers = useMutation({
		mutationFn: async ({ name }: { name?: string }) => {
			console.log("[useMcp] reconnecting:", name ?? "all servers");
			await client.queryClient.refetchQueries({
				queryKey: name ? [...mcpServerQueryKey, name] : [...mcpServerQueryKey],
			});
		},
	});

	const disconnectMcpServers = useMutation({
		mutationKey: disconnectMcpServersQueryKey,
		mutationFn: async () => {
			console.log("[useMcp] disconnecting all servers");

			for (const [name, mcpClient] of Object.entries(
				useMcpStore.getState().connectedServers,
			)) {
				setConnectedServer(name, null);
				await ClientMcpService.disconnect({ client: mcpClient });
			}
		},
	});

	// Drop connections and cached state for servers that no longer exist. The
	// connections are outside React; the store only keeps track of them.
	const namesKey = names.join(",");
	useEffect(() => {
		const current = new Set(namesKey ? namesKey.split(",") : []);
		const { connectedServers, setConnectedServer } = useMcpStore.getState();
		for (const [name, mcpClient] of Object.entries(connectedServers)) {
			if (current.has(name)) continue;
			setConnectedServer(name, null);
			void ClientMcpService.disconnect({ client: mcpClient });
			client.queryClient.removeQueries({
				queryKey: [...mcpServerQueryKey, name],
			});
		}
		// including servers that never connected
		const { logs, clearLogs } = useMcpLogStore.getState();
		for (const name of Object.keys(logs)) {
			if (!current.has(name)) clearLogs(name);
		}
	}, [namesKey, client.queryClient]);

	return { mcpServers, refreshMcpServers, disconnectMcpServers };
};
