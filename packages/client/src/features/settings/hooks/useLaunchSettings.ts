import { useMutation } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { useSettings } from "#client/features/settings/hooks/useSettings.ts";
import type { ProjectLike } from "#core/features/data/types/chat.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";

/** A project's launches as they are set up, and what changes them. */
export const useLaunchSettings = ({ project }: { project: ProjectLike }) => {
	const client = useContext(ClientContext);
	const { settings, applySettings } = useSettings({ project });

	const launches = useMemo(
		() => LaunchUtils.of(settings.data ? { settings: settings.data } : null),
		[settings.data],
	);

	const addLaunch = useMutation({
		...client.query.settings.addLaunch.mutationOptions(),
		onSuccess: applySettings,
	});

	const updateLaunch = useMutation({
		...client.query.settings.updateLaunch.mutationOptions(),
		onSuccess: applySettings,
	});

	// A launch taken off the list is stopped first: nothing would be left to
	// stop it with.
	const removeLaunch = useMutation({
		mutationFn: async (input: { id: string; project: ProjectLike }) => {
			await client.launch?.stop({ id: input.id }).catch(() => {});
			return await client.api.settings.removeLaunch.mutate(input);
		},
		onSuccess: applySettings,
	});

	return { launches, addLaunch, updateLaunch, removeLaunch };
};
