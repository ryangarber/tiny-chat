import { useMutation, useQuery } from "@tanstack/react-query";
import type { InstallProgress } from "computah/schema";
import { useContext, useState } from "react";
import { ClientContext } from "#client/client.ts";
import { nativeToolsQueryKey } from "#client/features/agent/hooks/useTools.ts";
import type { ComputahSurface } from "#client/features/agent/types/computah.ts";
import {
	type SurfacePermission,
	SurfaceUtils,
} from "#client/features/agent/utils/SurfaceUtils.ts";

export const surfaceStatusQueryKey = (surface: ComputahSurface) =>
	["useSurface", surface, "status"] as const;

/**
 * A computah surface's status (the browser, terminal or computer), and what
 * can be done about what it is missing: look again, install it, or ask the
 * OS for its grants. Each brings the toolset along with it.
 */
export const useSurface = (surface: ComputahSurface) => {
	const client = useContext(ClientContext);
	const capability = client.computah?.[surface];
	const queryKey = surfaceStatusQueryKey(surface);

	const getReport = async (refresh = false) =>
		capability
			? await capability
					.status({ refresh })
					.then((status) => SurfaceUtils.report(surface, status))
					.catch(SurfaceUtils.failed)
			: SurfaceUtils.unavailable();

	const surfaceStatus = useQuery({
		queryKey,
		queryFn: () => getReport(),
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	/** Lets go of what was found and looks again; the toolset follows. */
	const refresh = async () => {
		const report = await getReport(true);
		client.queryClient.setQueryData(queryKey, report);
		await client.queryClient.invalidateQueries({
			queryKey: nativeToolsQueryKey,
		});
		return report;
	};

	const recheckSurface = useMutation({ mutationFn: refresh });

	const [installProgress, setInstallProgress] =
		useState<InstallProgress | null>(null);

	/** Installs what is missing; answers what to tell the user, if anything. */
	const installSurface = useMutation({
		mutationFn: async () => {
			if (!capability) throw new Error("Nothing to install here");
			try {
				const result = await capability.install({
					onProgress: setInstallProgress,
				});
				await refresh();
				return SurfaceUtils.installed(result);
			} finally {
				setInstallProgress(null);
			}
		},
	});

	/** Raises the OS's prompt for a grant, or its settings where it will not prompt. */
	const requestPermission = useMutation({
		mutationFn: async (permission: SurfacePermission) => {
			if (!capability) throw new Error("Nothing to grant here");
			await capability.requestPermissions({
				owner: permission.owner,
				settings: !permission.promptable,
			});
			await refresh();
		},
	});

	return {
		surfaceStatus,
		recheckSurface,
		installSurface,
		installProgress,
		requestPermission,
	};
};
