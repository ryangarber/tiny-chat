import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { nativeToolsQueryKey } from "#client/features/agent/hooks/useTools.ts";
import { ComputerService } from "#core/features/tool/services/ComputerService.ts";
import type { zComputerStatus } from "#core/features/tool/types/computer.ts";

export const computerStatusQueryKey = ["useComputer", "status"] as const;

const unavailable: zComputerStatus = {
	available: false,
	error: "Computer use needs the desktop app or the CLI.",
};

/** Whether this host can use the computer, and how to look again. */
export const useComputer = () => {
	const client = useContext(ClientContext);

	const getStatus = () =>
		client.computer
			? ComputerService.status(client.computer)
			: Promise.resolve(unavailable);

	const computerStatus = useQuery({
		queryKey: computerStatusQueryKey,
		queryFn: getStatus,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	/** Asks again, as after granting a permission; the toolset follows. */
	const recheckComputer = useMutation({
		mutationFn: async () => {
			const status = await getStatus();
			client.queryClient.setQueryData(computerStatusQueryKey, status);
			await client.queryClient.invalidateQueries({
				queryKey: nativeToolsQueryKey,
			});
			return status;
		},
	});

	return { computerStatus, recheckComputer };
};
