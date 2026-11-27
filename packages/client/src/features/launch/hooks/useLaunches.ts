import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { LaunchService } from "#client/features/launch/services/LaunchService.ts";
import { useSettings } from "#client/features/settings/hooks/useSettings.ts";
import type { zLaunch } from "#core/features/data/types/user.ts";
import type { zLaunchStatus } from "#core/features/tool/types/launch.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";

/** How often what is running is read again while it is shown. */
const POLL_MS = 2000;

export const launchesQueryKey = ["useLaunches", "status"] as const;

/**
 * The open chat's project's launches, each with how it is doing on this
 * device, read again every couple of seconds while `enabled`; and what starts,
 * stops and restarts them. Status is only there where the host can run them
 * (`supported`): elsewhere the launches are listed without it.
 */
export const useLaunches = ({ enabled = true }: { enabled?: boolean } = {}) => {
	const client = useContext(ClientContext);
	const { chat } = useChat();
	const chatId = useChatStore((state) => state.active.chatId);
	const activeProject = useChatStore((state) => state.active.project);
	const projectId = chatId
		? (chat.data?.projectId ?? null)
		: (activeProject?.id ?? null);

	const { settings } = useSettings({ project: projectId });
	const launches = useMemo(
		() =>
			projectId
				? LaunchUtils.of(settings.data ? { settings: settings.data } : null)
				: [],
		[projectId, settings.data],
	);

	const host = client.launch;
	const service = useMemo(
		() => host && LaunchService.create({ client, launch: host }),
		[client, host],
	);

	const ids = launches.map((launch) => launch.id);
	const statuses = useQuery({
		queryKey: [...launchesQueryKey, ids],
		queryFn: async () => {
			if (!service) return new Map<string, zLaunchStatus>();
			const list = await service.status({ launches });
			return new Map(list.map((status) => [status.id, status]));
		},
		enabled: enabled && !!service && launches.length > 0,
		staleTime: 0,
		refetchInterval: POLL_MS,
	});

	const refresh = () =>
		client.queryClient.invalidateQueries({ queryKey: launchesQueryKey });

	const control = useMutation({
		mutationFn: async ({
			launch,
			action,
		}: {
			launch: zLaunch;
			action: "start" | "stop" | "restart";
		}) => {
			if (!service) throw new Error("Launches run in the desktop app and CLI");
			return await service[action]({ launch });
		},
		onSettled: refresh,
	});

	return {
		projectId,
		launches,
		supported: !!service,
		/** A launch's status, or how it stands before it ever ran. */
		statusOf: (launch: zLaunch) =>
			statuses.data?.get(launch.id) ?? LaunchUtils.idle(launch.id),
		isLoading: statuses.isLoading,
		control,
		/** Whether this launch is waiting on one of its controls. */
		isPending: (launch: zLaunch) =>
			control.isPending && control.variables?.launch.id === launch.id,
		logs: (launch: zLaunch, lines?: number) =>
			service?.logs({ launch, lines }) ?? Promise.resolve(""),
	};
};

/** A launch's output, read again while it is shown. */
export const useLaunchLogs = ({
	launch,
	lines = 500,
}: {
	launch: zLaunch | null;
	lines?: number;
}) => {
	const client = useContext(ClientContext);
	const host = client.launch;
	const logs = useQuery({
		queryKey: [...launchesQueryKey, "logs", launch?.id, lines],
		queryFn: async () =>
			LaunchUtils.stripAnsi(
				(await host?.logs({ id: launch?.id ?? "", lines })) ?? "",
			),
		enabled: !!host && !!launch,
		staleTime: 0,
		refetchInterval: POLL_MS / 2,
	});
	return logs;
};
