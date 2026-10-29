import { useMutation } from "@tanstack/react-query";
import { useCallback, useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { useSettings } from "#client/features/settings/hooks/useSettings.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { zConfig } from "#core/features/data/types/message.ts";

export const useModelSettings = () => {
	const client = useContext(ClientContext);

	const { settings, applySettings } = useSettings();

	const subagentConfig = useMemo(() => {
		return SettingsUtils.defaults({
			subagentConfig: settings.data?.subagentConfig,
		}).subagentConfig;
	}, [settings.data?.subagentConfig]);

	const setSubagentConfig = useMutation({
		...client.query.settings.setSubagentConfig.mutationOptions(),
		onSuccess: async (data) => {
			applySettings(data);
		},
	});

	/** Saves the subagent config, shown at once so quick edits each build on the last. */
	const { data: settingsData, refetch: refetchSettings } = settings;
	const { mutate: saveSubagentConfig } = setSubagentConfig;
	const updateSubagentConfig = useCallback(
		(config: zConfig | null) => {
			if (settingsData) {
				applySettings({ ...settingsData, subagentConfig: config });
			}
			saveSubagentConfig({ config }, { onError: () => void refetchSettings() });
		},
		[settingsData, refetchSettings, applySettings, saveSubagentConfig],
	);

	const dreamConfig = useMemo(() => {
		return SettingsUtils.defaults({ dreamConfig: settings.data?.dreamConfig })
			.dreamConfig;
	}, [settings.data?.dreamConfig]);

	const setDreamConfig = useMutation({
		...client.query.settings.setDreamConfig.mutationOptions(),
		onSuccess: async (data) => {
			applySettings(data);
		},
	});

	return {
		subagentConfig,
		setSubagentConfig,
		updateSubagentConfig,
		dreamConfig,
		setDreamConfig,
	};
};
