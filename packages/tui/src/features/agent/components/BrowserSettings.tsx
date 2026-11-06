import { useMemo, useState } from "react";
import { useBrowser } from "#client/features/agent/hooks/useBrowser.ts";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import Completions from "#tui/core/components/Completions.tsx";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import ConfigItemText, {
	type ConfigItem,
} from "#tui/features/agent/components/ConfigItem.tsx";

/**
 * The browser toolset's requirements and settings, beside its toggle in the
 * config it was opened from.
 */
export default function BrowserSettings({ toolset }: { toolset?: ConfigItem }) {
	const { browserStatus, browserSettings, recheckBrowser, setBrowserSettings } =
		useBrowser();
	const [selected, setSelected] = useState(0);

	useWorkingStatus(browserStatus, recheckBrowser);

	const groups = useMemo((): CompletionGroup<ConfigItem>[] => {
		const status = recheckBrowser.data ?? browserStatus.data;
		const headed = browserSettings.data?.headed ?? false;
		return [
			{ name: "Toolset", items: toolset ? [toolset] : [] },
			{
				name: "Requirements",
				items: status
					? [
							{
								name: "Node.js",
								value: "node",
								found: !!status.node,
								detail: status.node
									? `${status.node.version} · ${status.node.path}`
									: "not found",
							},
							{
								name: "Playwright",
								value: "playwright",
								found: !!status.playwright,
								detail: status.playwright
									? `${status.playwright.name}@${status.playwright.version} · ${status.playwright.path}`
									: "not found · npm install -g playwright",
							},
							...(status.display
								? [
										{
											name: "browser window",
											value: "display",
											found: status.display.available,
											detail: status.display.available
												? "can be shown on this desktop"
												: `${status.display.error ?? "no desktop to show it on"} · runs headless instead`,
										},
									]
								: []),
							...(status.error
								? [
										{
											name: "unavailable",
											value: "error",
											found: false,
											error: status.error,
										},
									]
								: []),
						]
					: [],
			},
			{
				name: "Browsers",
				items: (status?.browsers ?? []).map((browser) => ({
					name: `${browser.name}${browser.version ? ` ${browser.version}` : ""}`,
					value: browser.path,
					found: true,
					detail: `${browser.source}${browser.path === status?.browser?.path ? " · in use" : ""} · ${browser.path}`,
				})),
			},
			{
				name: "Settings",
				items: [
					{
						name: "show the browser window",
						value: "headed",
						enabled: headed,
						...(status?.display?.available === false
							? { detail: "not available here · runs headless" }
							: {}),
						onSelect: () => setBrowserSettings.mutate({ headed: !headed }),
					},
				],
			},
		];
	}, [
		toolset,
		browserStatus.data,
		browserSettings.data,
		recheckBrowser.data,
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
					name: "toggle",
					run: (item) => item.onSelect?.(),
					when: (item) => !!item.onSelect && !item.disabled,
				},
				toggle: {
					run: (item) => item.onSelect?.(),
					when: (item) => !!item.onSelect && !item.disabled,
				},
				refresh: { run: () => recheckBrowser.mutate() },
			}}
			actions={["back"]}
		/>
	);
}
