import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useConfigEditor } from "#client/features/agent/hooks/useConfigEditor.ts";
import { mcpServerQueryKey } from "#client/features/agent/hooks/useMcp.ts";
import { useSkills } from "#client/features/agent/hooks/useSkills.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { ClientMcpService } from "#client/features/agent/services/ClientMcpService.ts";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import { useMcpServerSettings } from "#client/features/settings/hooks/useMcpServerSettings.ts";
import { useModelSettings } from "#client/features/settings/hooks/useModelSettings.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import { zMCPServers } from "#core/features/data/types/user.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import type { Page } from "#tui/core/stores/useAppStore.ts";
import BrowserSettings from "#tui/features/agent/components/BrowserSettings.tsx";
import ConfigItemText, {
	type ConfigItem,
} from "#tui/features/agent/components/ConfigItem.tsx";
import McpServerEditor, {
	type McpServer,
} from "#tui/features/agent/components/McpServerEditor.tsx";
import Completions from "#tui/features/editor/components/Completions.tsx";
import Choice from "#tui/features/settings/components/Choice.tsx";
import ModelChoice from "#tui/features/settings/components/ModelChoice.tsx";

const BROWSER_TOOLSET = "browser";
const SUBAGENTS_TOOLSET = "subagents";

/** The toolset an MCP server's tools are listed under, as `useTools` names it. */
const getMcpToolsetName = (name: string) =>
	name.replace("-", "_").toLowerCase();

/**
 * What opens over the menu: a model or list arg's choice, a toolset's page, or
 * an MCP server's, named `mcp:<name>`.
 */
type Route =
	| "model"
	| `arg:${string}`
	| "browser"
	| "subagents"
	| `mcp:${string}`;

/**
 * One menu for a config's model, model args, tools and skills — the chat's,
 * or one kept in settings such as the subagent's — with the pages of the
 * toolsets that have settings of their own opened from it.
 */
export default function ConfigEditor({
	config,
	setConfig,
	onClear,
	onBack,
	subagents = true,
}: {
	config: zConfig | null;
	setConfig: (config: zConfig) => void;
	/** Lets the model be unset, which is what clears the config. */
	onClear?: () => void;
	/** Leaving the menu itself, as `usePage` takes it; back to the chat by default. */
	onBack?: () => Page | boolean | undefined;
	/** Opens the subagent's own config from its toolset. */
	subagents?: boolean;
}) {
	const { modelArgs, setModel, setModelArg, toggleToolset, toggleSkill } =
		useConfigEditor({ config, setConfig });
	const { nativeTools, mcpTools, refreshMcpServers } = useTools();
	const { nativeSkills, localSkills } = useSkills();
	const { subagentConfig, updateSubagentConfig } = useModelSettings();
	const { mcpServerSettingsUnparsed, setMcpServerSettings } =
		useMcpServerSettings();
	// Counted so the menu draws again as connections start and settle.
	const mcpFetching = useIsFetching({ queryKey: mcpServerQueryKey });
	const queryClient = useQueryClient();

	// The servers as last saved, so a change shows while it is being saved.
	const savingMcpServers = setMcpServerSettings.isPending
		? setMcpServerSettings.variables.mcpServers
		: undefined;
	const mcpServers = useMemo(
		(): Record<string, McpServer> =>
			(savingMcpServers
				? zMCPServers.parse(savingMcpServers)
				: mcpServerSettingsUnparsed.data) ?? {},
		[savingMcpServers, mcpServerSettingsUnparsed.data],
	);
	const updateMcpServers = (next: Record<string, McpServer>) =>
		setMcpServerSettings.mutate({ mcpServers: next });

	const [route, setRoute] = useState<Route | null>(null);
	// Kept here, so coming back from a page lands on the item it opened from.
	const [selected, setSelected] = useState(0);

	useWorkingStatus(
		nativeTools,
		mcpTools,
		nativeSkills,
		localSkills,
		refreshMcpServers,
		setMcpServerSettings,
	);

	// The subagent's config and a server's page handle their own way back.
	usePage({
		active: route !== "subagents" && !route?.startsWith("mcp:"),
		onBack: () => {
			if (!route) return onBack?.();
			setRoute(null);
			return false;
		},
	});

	const args = useMemo(
		() => (config?.args ?? {}) as Record<string, unknown>,
		[config?.args],
	);

	const toolsetItem = useCallback(
		(toolset: Toolset<any>): ConfigItem => {
			const name = ToolUtils.name({ toolset });
			const page =
				name === BROWSER_TOOLSET
					? "browser"
					: name === SUBAGENTS_TOOLSET && subagents
						? "subagents"
						: undefined;
			return {
				name,
				value: `toolset:${name}`,
				detail: toolset.tools
					.map((tool) => ToolUtils.name({ toolset, tool }))
					.join(", "),
				enabled: config ? ToolUtils.checkOne({ toolset, config }) : false,
				disabled: !toolset.status.valid,
				error: toolset.status.error,
				onSelect: () => toggleToolset(name),
				onOpen: page && (() => setRoute(page)),
			};
		},
		[config, subagents, toggleToolset],
	);

	/**
	 * Whether a server is connecting with its current settings — a connection
	 * started for settings since changed may never settle, and does not count.
	 */
	const isMcpConnecting = useCallback(
		(name: string, server: McpServer) =>
			mcpFetching > 0 &&
			queryClient.isFetching({
				queryKey: [
					...mcpServerQueryKey,
					name,
					ClientMcpService.getServerKey({ server }),
				],
			}) > 0,
		[mcpFetching, queryClient],
	);

	/** A server is listed from the settings, connected or not, like the app does. */
	const mcpItem = useCallback(
		(name: string): ConfigItem => {
			const toolsetName = getMcpToolsetName(name);
			const toolset = mcpTools.data?.find(
				(toolset) => toolset.name === toolsetName,
			);
			const isConnecting = isMcpConnecting(name, mcpServers[name]);
			return {
				name,
				value: `mcp:${name}`,
				detail:
					isConnecting || !toolset
						? "connecting..."
						: toolset.status.error
							? undefined
							: toolset.tools
									.map((tool) => ToolUtils.name({ toolset, tool }))
									.join(", ") || "no tools",
				enabled:
					config && toolset ? ToolUtils.checkOne({ toolset, config }) : false,
				disabled: !toolset?.status.valid,
				error: isConnecting ? undefined : toolset?.status.error,
				onSelect: () => toggleToolset(toolsetName),
				onOpen: () => setRoute(`mcp:${name}`),
			};
		},
		[config, mcpServers, mcpTools.data, isMcpConnecting, toggleToolset],
	);

	const mcpNamesKey = Object.keys(mcpServers).join(",");

	const addMcpServer = () => {
		let name = "server";
		let suffix = 2;
		while (name in mcpServers) name = `server-${suffix++}`;
		updateMcpServers({ ...mcpServers, [name]: { command: "" } });
		setRoute(`mcp:${name}`);
	};

	const refresh = () => {
		refreshMcpServers.mutate({});
		void nativeSkills.refetch();
		void localSkills.refetch();
	};

	const groups = useMemo((): CompletionGroup<ConfigItem>[] => {
		const model: CompletionGroup<ConfigItem> = {
			name: "Model",
			items: [
				{
					name: "model",
					value: "model",
					state: config?.model ?? "",
					detail: config?.provider || undefined,
					onSelect: () => setRoute("model"),
				},
				...modelArgs.map(
					(arg): ConfigItem => ({
						name: arg.name,
						value: `arg:${arg.name}`,
						state: String(args[arg.name] ?? arg.default),
						arg,
						onSelect:
							arg.type === "list"
								? () => setRoute(`arg:${arg.name}`)
								: undefined,
					}),
				),
			],
		};
		if (!config) return [model];

		const tools = (name: string, toolsets: Toolset<any>[]) => ({
			name,
			items: toolsets.map(toolsetItem),
		});
		const skills = (name: string, skills: zSkill[]) => ({
			name,
			items: skills.map(
				(skill): ConfigItem => ({
					name: skill.name,
					value: `skill:${skill.path}`,
					detail: DataUtils.getTextCleaned({
						data: skill.description,
						maxLength: 60,
					}),
					enabled: config.skills.includes(skill.path),
					disabled: !skill.name,
					onSelect: () => toggleSkill(skill.path),
				}),
			),
		});

		return [
			model,
			tools("Native tools", nativeTools.data ?? []),
			{
				name: "MCP tools",
				items: (mcpNamesKey ? mcpNamesKey.split(",") : []).map(mcpItem),
			},
			skills("Native skills", nativeSkills.data ?? []),
			skills("Local skills", localSkills.data ?? []),
		].filter((group) => group.items.length > 0);
	}, [
		config,
		args,
		modelArgs,
		nativeTools.data,
		mcpNamesKey,
		mcpItem,
		nativeSkills.data,
		localSkills.data,
		toolsetItem,
		toggleSkill,
	]);

	if (route === "model") {
		return (
			<ModelChoice
				feature="language"
				current={config}
				onSelect={(model) => {
					setModel(model);
					setRoute(null);
				}}
				onClear={
					onClear &&
					(() => {
						onClear();
						setRoute(null);
					})
				}
			/>
		);
	}

	if (route === "browser") {
		const toolset = (nativeTools.data ?? []).find(
			(toolset) => ToolUtils.name({ toolset }) === BROWSER_TOOLSET,
		);
		return (
			<BrowserSettings
				toolset={toolset && { ...toolsetItem(toolset), onOpen: undefined }}
			/>
		);
	}

	if (route === "subagents") {
		return (
			<ConfigEditor
				config={subagentConfig}
				setConfig={updateSubagentConfig}
				onClear={() => updateSubagentConfig(null)}
				onBack={() => {
					setRoute(null);
					return false;
				}}
				subagents={false}
			/>
		);
	}

	const mcpName = route?.startsWith("mcp:") ? route.slice("mcp:".length) : null;
	const mcpServer = mcpName ? mcpServers[mcpName] : undefined;
	if (mcpName && mcpServer) {
		const toolsetName = getMcpToolsetName(mcpName);
		return (
			<McpServerEditor
				key={mcpName}
				name={mcpName}
				server={mcpServer}
				isConnecting={isMcpConnecting(mcpName, mcpServer)}
				toolset={mcpTools.data?.find((toolset) => toolset.name === toolsetName)}
				onSave={(nextName, server) => {
					const servers = { ...mcpServers };
					delete servers[mcpName];
					servers[nextName] = server;
					updateMcpServers(servers);
					if (nextName === mcpName) return;
					// The toolset is renamed with the server, so it stays enabled.
					if (config?.toolsets.includes(toolsetName)) {
						setConfig({
							...config,
							toolsets: config.toolsets.map((value) =>
								value === toolsetName ? getMcpToolsetName(nextName) : value,
							),
						});
					}
					setRoute(`mcp:${nextName}`);
				}}
				onDelete={() => {
					const servers = { ...mcpServers };
					delete servers[mcpName];
					updateMcpServers(servers);
				}}
				onRefresh={() => refreshMcpServers.mutate({ name: mcpName })}
				onClose={() => setRoute(null)}
			/>
		);
	}

	const listArg = modelArgs.find(
		(arg) => arg.type === "list" && route === `arg:${arg.name}`,
	);
	if (listArg?.type === "list") {
		const current = args[listArg.name] ?? listArg.default;
		return (
			<Choice
				groups={[
					{
						items: listArg.values.map((value) => ({
							name: value,
							value,
							active: value === current,
						})),
					},
				]}
				onSelect={(item) => {
					setModelArg(listArg.name, item.value);
					setRoute(null);
				}}
			/>
		);
	}

	const item = groups.flatMap((group) => group.items)[selected];

	return (
		<Completions<CompletionGroup<ConfigItem>, ConfigItem>
			groups={groups}
			selected={selected}
			setSelected={setSelected}
			selectFirstOnChange={false}
			renderItem={({ item }) => <ConfigItemText item={item} />}
			renderEmpty={() => "nothing here yet"}
			bindings={{
				primary: {
					name: (item) =>
						!item.onSelect
							? "open"
							: item.enabled === undefined
								? "change"
								: "toggle",
					run: (item) => (item.onSelect ?? item.onOpen)?.(),
					when: (item) => (item.onSelect ? !item.disabled : !!item.onOpen),
				},
				toggle: {
					run: (item) => item.onSelect?.(),
					when: (item) =>
						item.enabled !== undefined && !!item.onSelect && !item.disabled,
				},
				edit: {
					run: (item) => item.onOpen?.(),
					when: (item) => !!item.onOpen && !!item.onSelect,
				},
				create: config
					? { name: "new mcp server", run: addMcpServer }
					: undefined,
				// Only a server of the user's own can be taken off the list.
				remove: {
					name: "remove",
					run: (item) => {
						const name = item.value.slice("mcp:".length);
						const { [name]: _, ...servers } = mcpServers;
						updateMcpServers(servers);
					},
					when: (item) => item.value.startsWith("mcp:"),
				},
				refresh: config ? { run: refresh } : undefined,
			}}
			// A range is adjusted where it is listed, outside the verbs.
			onInput={({ item, key }) => {
				const arg = item?.arg;
				if (arg?.type === "range" && (key.leftArrow || key.rightArrow)) {
					const step = (arg.max - arg.min) / 50;
					const value = Number(args[arg.name] ?? arg.default);
					const next = value + (key.rightArrow ? step : -step);
					setModelArg(
						arg.name,
						Math.min(arg.max, Math.max(arg.min, Number(next.toPrecision(6)))),
					);
					return true;
				}
			}}
			actions={[
				{ key: "←→", name: "adjust", when: item?.arg?.type === "range" },
				"back",
			]}
		/>
	);
}
