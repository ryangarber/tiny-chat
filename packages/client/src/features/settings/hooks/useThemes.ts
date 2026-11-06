import { useMutation } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { useSettings } from "#client/features/settings/hooks/useSettings.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";

export const useThemes = () => {
	const client = useContext(ClientContext);

	const { settings, applySettings } = useSettings();

	const theme = useMemo(() => {
		return SettingsUtils.defaults({ theme: settings.data?.theme }).theme;
	}, [settings.data?.theme]);

	const setTheme = useMutation({
		...client.query.settings.setTheme.mutationOptions(),
		onSuccess: applySettings,
	});

	const codeTheme = useMemo(() => {
		return SettingsUtils.defaults({
			theme: settings.data?.theme,
			codeTheme: settings.data?.codeTheme,
		}).codeTheme;
	}, [settings.data?.theme, settings.data?.codeTheme]);

	const setCodeTheme = useMutation({
		...client.query.settings.setCodeTheme.mutationOptions(),
		onSuccess: applySettings,
	});

	const tuiImages = useMemo(() => {
		return SettingsUtils.defaults({ tuiImages: settings.data?.tuiImages })
			.tuiImages;
	}, [settings.data?.tuiImages]);

	const setTuiImages = useMutation({
		...client.query.settings.setTuiImages.mutationOptions(),
		onSuccess: applySettings,
	});

	return {
		theme,
		setTheme,
		codeTheme,
		setCodeTheme,
		tuiImages,
		setTuiImages,
	};
};
