import { useContext, useMemo, useState } from "react";
import { ClientContext } from "#client/client.ts";
import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import { useEmbeddingSettings } from "#client/features/settings/hooks/useEmbeddingSettings.ts";
import { useHiddenModels } from "#client/features/settings/hooks/useHiddenModels.ts";
import { useInstructions } from "#client/features/settings/hooks/useInstructions.ts";
import { useModelSettings } from "#client/features/settings/hooks/useModelSettings.ts";
import { useProviderSettings } from "#client/features/settings/hooks/useProviderSettings.ts";
import { useShellSettings } from "#client/features/settings/hooks/useShellSettings.ts";
import { useThemes } from "#client/features/settings/hooks/useThemes.ts";
import { ThemeUtils } from "#core/core/utils/ThemeUtils.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import type {
	ModelProviderStatus,
	zModelFeature,
} from "#core/features/provider/types/model.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import Text from "#tui/core/components/Text.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import Choice, {
	type ChoiceItem,
} from "#tui/features/settings/components/Choice.tsx";
import CommandSettings from "#tui/features/settings/components/CommandSettings.tsx";
import Details, {
	type DetailsItem,
} from "#tui/features/settings/components/Details.tsx";
import FolderSettings from "#tui/features/settings/components/FolderSettings.tsx";
import InstructionSettings from "#tui/features/settings/components/InstructionSettings.tsx";
import MemoryBudgetSettings from "#tui/features/settings/components/MemoryBudgetSettings.tsx";
import ModelChoice from "#tui/features/settings/components/ModelChoice.tsx";
import TextList, {
	type Draft,
} from "#tui/features/settings/components/TextList.tsx";

type Feature = Exclude<zModelFeature, "language:tools">;

const onOff = (value: boolean) => (value ? "on" : "off");

const summarize = (provider: ProviderState<ProviderStatus>) => {
	const status = provider.status;
	if ("models" in status) {
		const count = (status.models as unknown[]).length;
		return `${count} ${count === 1 ? "model" : "models"}`;
	}
	if ("features" in status) {
		return (status.features as string[]).join(", ") || "no features";
	}
	return status.valid ? "connected" : "not connected";
};

/** The user's own settings; a project's are edited from its page in /projects. */
export default function Settings() {
	const client = useContext(ClientContext);

	const { providers, updateProviders, isUpdating } = useProviders();

	const { theme, setTheme, codeTheme, setCodeTheme } = useThemes();
	const {
		useProviderCache,
		setUseProviderCache,
		useBrowserModels,
		setUseBrowserModels,
		preferredWebProvider,
		setPreferredWebProvider,
		providerSettings,
		setProviderSetting,
	} = useProviderSettings();
	const { hiddenModels, setHiddenModels } = useHiddenModels();
	const { dreamConfig, setDreamConfig } = useModelSettings();
	const {
		embeddingConfig,
		setEmbeddingConfig,
		useEmbeddingSearch,
		setUseEmbeddingSearch,
	} = useEmbeddingSettings();
	const { instructions, memoryBudget } = useInstructions({ project: null });
	const { commands, folders } = useShellSettings({ project: null });

	useWorkingStatus(
		setTheme,
		setCodeTheme,
		setUseProviderCache,
		setUseBrowserModels,
		setPreferredWebProvider,
		setProviderSetting,
		setHiddenModels,
		setDreamConfig,
		setEmbeddingConfig,
		setUseEmbeddingSearch,
		updateProviders,
	);

	// The pages open, root first. A provider's page is named `keys:<name>`.
	const [path, setPath] = useState<string[]>([]);
	const route = path.at(-1) ?? null;
	const push = (next: string) => setPath((current) => [...current, next]);
	const pop = () => setPath((current) => current.slice(0, -1));

	const [draft, setDraft] = useState<Draft | null>(null);
	const [pendingEmbedding, setPendingEmbedding] = useState<zConfig | null>(
		null,
	);

	usePage({
		onBack: () => {
			if (draft) {
				setDraft(null);
				return false;
			}
			if (path.length) {
				pop();
				return false;
			}
		},
	});

	const modelProviders = useMemo(
		() =>
			(providers.data ?? []).filter(
				(provider): provider is ProviderState<ModelProviderStatus> =>
					provider.type === "model",
			),
		[providers.data],
	);

	const [selected, setSelected] = useState(0);

	const root = useMemo<CompletionGroup<DetailsItem>[]>(() => {
		const groups: CompletionGroup<DetailsItem>[] = [
			{
				name: "appearance",
				items: [
					{ name: "theme", value: "theme", state: theme, route: "theme" },
					{
						name: "code theme",
						value: "code theme",
						state: codeTheme,
						route: "codeTheme",
					},
				],
			},
			{
				name: "performance",
				items: [
					{
						name: "provider cache",
						value: "provider cache",
						state: onOff(useProviderCache),
						route: "providerCache",
					},
					{
						name: "no native provider",
						value: "no native provider",
						state: onOff(!useBrowserModels),
						route: "browserModels",
					},
				],
			},
			{
				name: "preferred models",
				items: [
					{
						name: "generation",
						value: "generation",
						state: `${hiddenModels?.language?.length ?? 0} hidden`,
						route: "hiddenLanguage",
					},
					{
						name: "embedding",
						value: "embedding",
						state: `${hiddenModels?.embedding?.length ?? 0} hidden`,
						route: "hiddenEmbedding",
					},
				],
			},
			{
				name: "context",
				items: [
					{
						name: "instructions",
						value: "instructions",
						state: String(instructions?.length ?? 0),
						route: "instructions",
					},
					{
						name: "memory budget",
						value: "memory budget",
						state: String(memoryBudget),
						route: "memoryBudget",
					},
				],
			},
			{
				name: "shell",
				items: [
					...(client.desktop
						? [
								{
									name: "folders",
									value: "folders",
									state: String(folders.length),
									route: "folders",
								},
							]
						: []),
					{
						name: "commands",
						value: "commands",
						state: String(commands.length),
						route: "commands",
					},
				],
			},
			{
				name: "retrieval",
				items: [
					{
						name: "embedding model",
						value: "embedding model",
						state: embeddingConfig?.model,
						route: "embeddingConfig",
					},
					{
						name: "smart search",
						value: "smart search",
						state: onOff(useEmbeddingSearch),
						route: "smartSearch",
					},
				],
			},
			{
				name: "agents",
				items: [
					{
						name: "dreaming model",
						value: "dreaming model",
						state: dreamConfig?.model,
						route: "dreamConfig",
					},
				],
			},
			{
				name: "web",
				items: [
					{
						name: "preferred provider",
						value: "preferred provider",
						state: preferredWebProvider ?? undefined,
						route: "webProvider",
					},
				],
			},
			{
				name: "keys",
				items: [{ name: "providers", value: "providers", route: "keys" }],
			},
		];
		return groups;
	}, [
		theme,
		codeTheme,
		useProviderCache,
		useBrowserModels,
		hiddenModels,
		instructions,
		memoryBudget,
		folders,
		commands,
		embeddingConfig,
		useEmbeddingSearch,
		dreamConfig,
		preferredWebProvider,
		client,
	]);

	/** A choice between plain values, the one in effect marked. */
	const choose = (
		values: readonly string[],
		current: string | undefined,
		set: (value: string) => void,
	) => (
		<Choice
			groups={[
				{
					items: values.map((value) => ({
						name: value,
						value,
						active: value === current,
					})),
				},
			]}
			onSelect={(item) => {
				set(item.value);
				pop();
			}}
		/>
	);

	/** A model for `feature`, kept with the tools and skills already chosen. */
	const chooseModel = (
		feature: Feature,
		current: zConfig | null | undefined,
		set: (config: zConfig | null) => void,
	) => (
		<ModelChoice
			feature={feature}
			current={current}
			onSelect={(model) =>
				set(
					zConfig.parse({
						...model,
						toolsets: current?.toolsets,
						skills: current?.skills,
					}),
				)
			}
			onClear={() => set(null)}
		/>
	);

	/** Which models of `feature` are shown, each toggled where it is listed. */
	const chooseVisible = (feature: "language" | "embedding") => {
		const hidden = hiddenModels?.[feature] ?? [];
		const isHidden = (provider: string, model: string) =>
			hidden.some((h) => h.provider === provider && h.model === model);
		const toggle = ({
			config,
		}: {
			config: Pick<zConfig, "provider" | "model">;
		}) =>
			setHiddenModels.mutate({
				feature,
				models: isHidden(config.provider, config.model)
					? hidden.filter(
							(h) =>
								!(h.provider === config.provider && h.model === config.model),
						)
					: [...hidden, zConfig.parse(config)],
			});
		return (
			<Choice<ChoiceItem & { config: Pick<zConfig, "provider" | "model"> }>
				tabs
				groups={[...modelProviders]
					.sort((a, b) => a.name.localeCompare(b.name))
					.map((provider) => ({
						name: provider.name,
						items: provider.status.models
							.filter((model) => model.features.includes(feature))
							.sort((a, b) => a.name.localeCompare(b.name))
							.map((model) => ({
								name: model.name,
								value: `${provider.name}/${model.name}`,
								config: { provider: provider.name, model: model.name },
								// Dimmed by the list, so it is the hidden ones that are.
								active: isHidden(provider.name, model.name),
							})),
					}))
					.filter((group) => group.items.length)}
				onSelect={toggle}
				selectName="toggle"
				bindings={{ toggle: { run: toggle } }}
				renderItem={(item) => (
					<>
						<Text>{item.name}</Text>
						<Text>{item.active ? "hidden" : "shown"}</Text>
					</>
				)}
			/>
		);
	};

	if (route === "theme") {
		return choose(ThemeUtils.themes, theme, (value) =>
			setTheme.mutate({ theme: value as typeof theme }),
		);
	}
	if (route === "codeTheme") {
		return choose(ThemeUtils.codeThemesByTheme[theme], codeTheme, (value) =>
			setCodeTheme.mutate({ codeTheme: value as typeof codeTheme }),
		);
	}
	if (route === "providerCache") {
		return choose(["on", "off"], onOff(useProviderCache), (value) =>
			setUseProviderCache.mutate({ useProviderCache: value === "on" }),
		);
	}
	if (route === "browserModels") {
		return choose(["on", "off"], onOff(!useBrowserModels), (value) =>
			setUseBrowserModels.mutate({ useBrowserModels: value !== "on" }),
		);
	}
	if (route === "smartSearch") {
		return choose(["on", "off"], onOff(useEmbeddingSearch), (value) => {
			if (!embeddingConfig) return;
			setUseEmbeddingSearch.mutate({ useEmbeddingSearch: value === "on" });
		});
	}
	if (route === "memoryBudget") {
		return <MemoryBudgetSettings project={null} onDone={pop} />;
	}
	if (route === "webProvider") {
		return choose(
			(providers.data ?? [])
				.filter((provider) => provider.type === "web" && provider.status.valid)
				.map((provider) => provider.name),
			preferredWebProvider ?? undefined,
			(value) =>
				setPreferredWebProvider.mutate({ preferredWebProvider: value }),
		);
	}
	if (route === "hiddenLanguage") return chooseVisible("language");
	if (route === "hiddenEmbedding") return chooseVisible("embedding");

	if (route === "dreamConfig") {
		return chooseModel("language", dreamConfig, (config) => {
			setDreamConfig.mutate({ config });
			pop();
		});
	}
	if (route === "embeddingConfig") {
		return chooseModel("embedding", embeddingConfig, (config) => {
			// Every embedding is made again, so this is asked about first.
			setPendingEmbedding(config);
			setPath((current) => [...current.slice(0, -1), "embeddingConfirm"]);
		});
	}
	if (route === "embeddingConfirm") {
		return (
			<Choice
				groups={[
					{
						items: [
							{ name: "confirm", value: "confirm" },
							{ name: "cancel", value: "cancel" },
						],
					},
				]}
				before={
					<Text color="textSubtle">
						{pendingEmbedding
							? `All embeddings will be regenerated using the model ${pendingEmbedding.model}.`
							: "Features like memory and smart search will not be available."}
					</Text>
				}
				onSelect={(item) => {
					if (item.value === "confirm") {
						setEmbeddingConfig.mutate({ config: pendingEmbedding });
					}
					setPendingEmbedding(null);
					pop();
				}}
			/>
		);
	}

	if (route === "instructions") {
		return (
			<InstructionSettings project={null} draft={draft} setDraft={setDraft} />
		);
	}
	if (route === "commands") {
		return <CommandSettings project={null} draft={draft} setDraft={setDraft} />;
	}
	if (route === "folders") {
		return <FolderSettings project={null} draft={draft} setDraft={setDraft} />;
	}

	if (route === "keys") {
		const keyed = (providers.data ?? []).filter(
			(provider) => provider.settings.length,
		);
		return (
			<Choice<ChoiceItem & { provider: string }>
				tabs
				groups={(["model", "web", "other"] as const)
					.map((type) => ({
						name: type,
						items: keyed
							.filter((provider) => provider.type === type)
							.map((provider) => ({
								name: provider.name,
								value: provider.name,
								provider: provider.name,
								detail: isUpdating(provider.name)
									? "checking..."
									: summarize(provider),
							})),
					}))
					.filter((group) => group.items.length)}
				onSelect={({ provider }) => push(`keys:${provider}`)}
				selectName="open"
				bindings={{ refresh: { run: () => updateProviders.mutate({}) } }}
				renderItem={(item) => (
					<>
						<Text>{item.name}</Text>
						<Text color="textSubtle">{item.detail}</Text>
					</>
				)}
			/>
		);
	}
	if (route?.startsWith("keys:")) {
		const name = route.slice("keys:".length);
		const provider = providers.data?.find((p) => p.name === name);
		if (!provider) return null;
		return (
			<TextList
				entries={provider.settings.map((key) => ({
					label: key,
					text: providerSettings?.[name]?.[key] ?? "",
				}))}
				draft={draft}
				setDraft={setDraft}
				placeholder="value"
				mask
				onEdit={(index, value) =>
					setProviderSetting.mutate({
						provider: name,
						key: provider.settings[index],
						value,
					})
				}
				bindings={{
					refresh: {
						run: () => updateProviders.mutate({ providers: [name] }),
					},
				}}
			/>
		);
	}

	return (
		<Details
			groups={root}
			selected={selected}
			setSelected={setSelected}
			onOpen={push}
		/>
	);
}
