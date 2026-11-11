import { useMemo, useState } from "react";
import { useBrowser } from "#client/features/agent/hooks/useBrowser.ts";
import { useSurface } from "#client/features/agent/hooks/useSurface.ts";
import type { ComputahSurface } from "#client/features/agent/types/computah.ts";
import { SurfaceUtils } from "#client/features/agent/utils/SurfaceUtils.ts";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import Completions from "#tui/core/components/Completions.tsx";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import ConfigItemText, {
	type ConfigItem,
} from "#tui/features/agent/components/ConfigItem.tsx";

/**
 * A computah surface's toolset (the browser, terminal or computer) with what
 * it needs beside its toggle: its requirements, the grants it is missing and
 * installing what it lacks, and the browser's own setting.
 */
export default function SurfaceSettings({
	surface,
	toolset,
}: {
	surface: ComputahSurface;
	toolset?: ConfigItem;
}) {
	const {
		surfaceStatus,
		recheckSurface,
		installSurface,
		installProgress,
		requestPermission,
	} = useSurface(surface);
	const { browserSettings, setBrowserSettings } = useBrowser();
	const [selected, setSelected] = useState(0);

	useWorkingStatus(
		surfaceStatus,
		recheckSurface,
		installSurface,
		requestPermission,
	);

	const groups = useMemo((): CompletionGroup<ConfigItem>[] => {
		const report = recheckSurface.data ?? surfaceStatus.data;
		const headed = browserSettings.data?.headed ?? false;
		const display = report?.requirements.find(
			(requirement) => requirement.key === "display",
		);
		const problems = [
			report?.error,
			installSurface.data,
			installSurface.error?.message,
			requestPermission.error?.message,
		].filter((message): message is string => !!message);

		return [
			{ name: "Toolset", items: toolset ? [toolset] : [] },
			{
				name: "Requirements",
				items: [
					...(report?.requirements ?? []).map((requirement) => ({
						name: requirement.label,
						value: requirement.key,
						found: requirement.found,
						detail: requirement.detail,
					})),
					...problems.map((message, index) => ({
						name: "unavailable",
						value: `error:${index}`,
						found: false,
						error: message,
					})),
				],
			},
			{
				name: "Permissions",
				items: (report?.permissions ?? []).map((permission) => ({
					name: permission.label,
					value: permission.key,
					found: permission.granted,
					detail: permission.granted
						? "granted"
						: permission.promptable
							? "enter to request"
							: "enter to open settings",
					...(permission.granted
						? {}
						: { onSelect: () => requestPermission.mutate(permission) }),
				})),
			},
			{
				name: "Install",
				items: [
					...(report?.install
						? [
								{
									name: `install ${report.install}`,
									value: "install",
									found: false,
									detail: installProgress
										? SurfaceUtils.progress(installProgress)
										: installSurface.isPending
											? "installing…"
											: "enter to install",
									disabled: installSurface.isPending,
									onSelect: () => installSurface.mutate(),
								},
							]
						: []),
					...(report?.note
						? [
								{
									name: "note",
									value: "note",
									found: true,
									detail: report.note,
								},
							]
						: []),
				],
			},
			...(surface === "browser"
				? [
						{
							name: "Settings",
							items: [
								{
									name: "show the browser window",
									value: "headed",
									enabled: headed,
									...(display && !display.found
										? { detail: "not available here · runs headless" }
										: {}),
									onSelect: () =>
										setBrowserSettings.mutate({ headed: !headed }),
								},
							],
						},
					]
				: []),
		];
	}, [
		surface,
		toolset,
		surfaceStatus.data,
		recheckSurface.data,
		installSurface,
		installProgress,
		requestPermission,
		browserSettings.data,
		setBrowserSettings,
	]);

	return (
		<Completions<CompletionGroup<ConfigItem>, ConfigItem>
			groups={groups}
			selected={selected}
			setSelected={setSelected}
			selectFirstOnChange={false}
			renderItem={({ item }) => <ConfigItemText item={item} />}
			bindings={{
				primary: {
					name: "select",
					run: (item) => item.onSelect?.(),
					when: (item) => !!item.onSelect && !item.disabled,
				},
				toggle: {
					run: (item) => item.onSelect?.(),
					when: (item) => !!item.onSelect && !item.disabled,
				},
				refresh: { run: () => recheckSurface.mutate() },
			}}
			actions={["back"]}
		/>
	);
}
