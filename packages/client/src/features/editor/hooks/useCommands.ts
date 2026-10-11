import { useCallback, useContext, useRef } from "react";
import { ClientContext } from "#client/client.ts";
import { useConfig } from "#client/features/agent/hooks/useConfig.ts";
import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import { useSkills } from "#client/features/agent/hooks/useSkills.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	CommandChoiceGroup,
	CommandGroup,
	CommandItem,
} from "#client/features/editor/types/command.ts";
import { useEmbeddingSettings } from "#client/features/settings/hooks/useEmbeddingSettings.ts";
import { useInstructions } from "#client/features/settings/hooks/useInstructions.ts";
import { usePresets } from "#client/features/settings/hooks/usePresets.ts";
import { useProviderSettings } from "#client/features/settings/hooks/useProviderSettings.ts";
import { useThemes } from "#client/features/settings/hooks/useThemes.ts";
import { ThemeUtils } from "#core/core/utils/ThemeUtils.ts";
import type { ModelProviderStatus } from "#core/features/provider/types/model.ts";
import type { ProviderState } from "#core/features/provider/types/provider.ts";

/** The budgets the memory can be filled up to, as the app's slider steps. */
const MEMORY_BUDGETS = Array.from({ length: 21 }, (_, i) => i * 500);

const onOff = (value: boolean) => (value ? "on" : "off");

/**
 * Build the commands available to any client, optionally extended with
 * commands that only make sense for the host of the input.
 */
export const useCommands = ({
	commands = [],
	onOpenSettings,
	onOpenChats,
	onOpenFiles,
	onOpenProjects,
	onOpenConfig,
	onOpenTools,
	onOpenSkills,
	onOpenUploads,
	onOpenGitHub,
	onOpenMemories,
	onOpenActions,
	onOpenConsole,
}: {
	commands?: CommandItem[];
	onOpenSettings?: () => void;
	onOpenChats?: () => void;
	onOpenFiles?: () => void;
	onOpenProjects?: () => void;
	onOpenConfig?: () => void;
	onOpenTools?: () => void;
	onOpenSkills?: () => void;
	onOpenUploads?: () => void;
	onOpenGitHub?: () => void;
	onOpenMemories?: () => void;
	onOpenActions?: () => void;
	onOpenConsole?: () => void;
} = {}) => {
	const client = useContext(ClientContext);

	const { providers, updateProviders } = useProviders();
	const { skills, localSkills } = useSkills();
	const { refreshMcpServers } = useTools();
	const { config, setConfig, setModel, modelArgs, setModelArg } = useConfig();
	const { presets, setPreset, unsetPreset } = usePresets();

	const project = useChatStore((state) => state.active.project);
	const { chat } = useChat();
	const { theme, setTheme, codeTheme, setCodeTheme } = useThemes();
	const {
		useProviderCache,
		setUseProviderCache,
		useBrowserModels,
		setUseBrowserModels,
		preferredWebProvider,
		setPreferredWebProvider,
	} = useProviderSettings();
	const { embeddingConfig, useEmbeddingSearch, setUseEmbeddingSearch } =
		useEmbeddingSettings();
	const { memoryBudget, setMemoryBudget } = useInstructions({ project });

	const clientRef = useRef(client);
	clientRef.current = client;

	const chatRef = useRef(chat.data);
	chatRef.current = chat.data;

	const commandsRef = useRef(commands);
	commandsRef.current = commands;

	const onOpenSettingsRef = useRef(onOpenSettings);
	onOpenSettingsRef.current = onOpenSettings;
	const onOpenChatsRef = useRef(onOpenChats);
	onOpenChatsRef.current = onOpenChats;
	const onOpenFilesRef = useRef(onOpenFiles);
	onOpenFilesRef.current = onOpenFiles;
	const onOpenProjectsRef = useRef(onOpenProjects);
	onOpenProjectsRef.current = onOpenProjects;
	const onOpenConfigRef = useRef(onOpenConfig);
	onOpenConfigRef.current = onOpenConfig;
	const onOpenToolsRef = useRef(onOpenTools);
	onOpenToolsRef.current = onOpenTools;
	const onOpenSkillsRef = useRef(onOpenSkills);
	onOpenSkillsRef.current = onOpenSkills;
	const onOpenUploadsRef = useRef(onOpenUploads);
	onOpenUploadsRef.current = onOpenUploads;
	const onOpenGitHubRef = useRef(onOpenGitHub);
	onOpenGitHubRef.current = onOpenGitHub;
	const onOpenMemoriesRef = useRef(onOpenMemories);
	onOpenMemoriesRef.current = onOpenMemories;
	const onOpenActionsRef = useRef(onOpenActions);
	onOpenActionsRef.current = onOpenActions;
	const onOpenConsoleRef = useRef(onOpenConsole);
	onOpenConsoleRef.current = onOpenConsole;

	const providersRef = useRef(providers.data);
	providersRef.current = providers.data;
	const updateProvidersRef = useRef(updateProviders);
	updateProvidersRef.current = updateProviders;

	const configRef = useRef(config);
	configRef.current = config;
	const setConfigRef = useRef(setConfig);
	setConfigRef.current = setConfig;
	const setModelRef = useRef(setModel);
	setModelRef.current = setModel;

	const modelArgsRef = useRef(modelArgs);
	modelArgsRef.current = modelArgs;
	const setModelArgRef = useRef(setModelArg);
	setModelArgRef.current = setModelArg;

	const presetsRef = useRef(presets);
	presetsRef.current = presets;
	const setPresetRef = useRef(setPreset);
	setPresetRef.current = setPreset;
	const unsetPresetRef = useRef(unsetPreset);
	unsetPresetRef.current = unsetPreset;

	const skillsRef = useRef(skills);
	skillsRef.current = skills;
	const localSkillsRef = useRef(localSkills);
	localSkillsRef.current = localSkills;

	const refreshMcpServersRef = useRef(refreshMcpServers);
	refreshMcpServersRef.current = refreshMcpServers;

	// The settings that are a choice between a few plain values.
	const settingsRef = useRef({
		project,
		theme,
		setTheme,
		codeTheme,
		setCodeTheme,
		useProviderCache,
		setUseProviderCache,
		useBrowserModels,
		setUseBrowserModels,
		preferredWebProvider,
		setPreferredWebProvider,
		embeddingConfig,
		useEmbeddingSearch,
		setUseEmbeddingSearch,
		memoryBudget,
		setMemoryBudget,
	});
	settingsRef.current = {
		project,
		theme,
		setTheme,
		codeTheme,
		setCodeTheme,
		useProviderCache,
		setUseProviderCache,
		useBrowserModels,
		setUseBrowserModels,
		preferredWebProvider,
		setPreferredWebProvider,
		embeddingConfig,
		useEmbeddingSearch,
		setUseEmbeddingSearch,
		memoryBudget,
		setMemoryBudget,
	};

	const getCommands = useCallback((): CommandGroup[] => {
		const models: CommandChoiceGroup[] =
			providersRef.current
				?.filter(
					(provider): provider is ProviderState<ModelProviderStatus> =>
						provider.type === "model",
				)
				.map((provider) => ({
					name: provider.name,
					items: provider.status.models.map((model) => ({
						name: model.name,
						value: model.name,
						active:
							configRef.current.provider === provider.name &&
							configRef.current.model === model.name,
						run: () =>
							setModelRef.current({
								provider: provider.name,
								model: model.name,
							}),
					})),
				})) ?? [];

		const modelArgs: CommandItem[] = modelArgsRef.current.flatMap((arg) => {
			if (arg.type === "list") {
				return {
					name: arg.name,
					value: arg.name,
					choices: [
						{
							items: arg.values.map((value) => ({
								name: value,
								value,
								active:
									configRef.current.args?.[arg.name] === value ||
									(!configRef.current.args?.[arg.name] &&
										arg.default === value),
								run: () => setModelArgRef.current(arg.name, value),
							})),
						},
					],
				};
			} else if (arg.type === "range") {
				return {
					name: arg.name,
					value: arg.name,
					dynamic: true,
					run: (value) => {
						if (!value) return;
						const int = Number(value);
						if (!Number.isInteger(int)) return;
						if (int < arg.min || int > arg.max) return;
						setModelArgRef.current(arg.name, int);
					},
				};
			}
			return [];
		});

		const presets: CommandChoiceGroup[] = [
			{
				items: Object.entries(presetsRef.current ?? {}).map(
					([name, preset]) => ({
						name,
						value: name,
						run: (command) => {
							if (command.name === "preset") {
								setConfigRef.current(preset);
							} else if (command.name === "unset-preset") {
								unsetPresetRef.current.mutate({
									name,
								});
							}
						},
					}),
				),
			},
		];

		const skills: CommandItem[] = skillsRef.current.map((skill) => ({
			name: skill.name,
			value: `skill:${skill.path}`,
		}));

		// Only offered where the host has somewhere to open them.
		const uploads: CommandItem[] = [
			...(onOpenUploadsRef.current
				? [
						{
							name: "uploads",
							value: "uploads",
							run: () => onOpenUploadsRef.current?.(),
						},
					]
				: []),
			...(onOpenGitHubRef.current
				? [
						{
							name: "github",
							value: "github",
							run: () => onOpenGitHubRef.current?.(),
						},
					]
				: []),
		];

		// What the user is remembered by and has scheduled, across their chats.
		const userData: CommandItem[] = [
			...(onOpenMemoriesRef.current
				? [
						{
							name: "memories",
							value: "memories",
							run: () => onOpenMemoriesRef.current?.(),
						},
					]
				: []),
			...(onOpenActionsRef.current
				? [
						{
							name: "actions",
							value: "actions",
							run: () => onOpenActionsRef.current?.(),
						},
					]
				: []),
		];

		// One config menu where the host has it; its tools and skills pages otherwise.
		const capabilities: CommandItem[] = onOpenConfigRef.current
			? [
					{
						name: "config",
						value: "config",
						run: () => onOpenConfigRef.current?.(),
					},
				]
			: [
					{
						name: "tools",
						value: "tools",
						run: () => onOpenToolsRef.current?.(),
					},
					{
						name: "skills",
						value: "skills",
						run: () => onOpenSkillsRef.current?.(),
					},
				];

		const shell: CommandItem[] = clientRef.current.shell?.chdir
			? [
					{
						name: "cd",
						value: "cd",
						dynamic: true,
						run: async (value) => {
							if (!value) return;
							await clientRef.current.shell?.chdir?.({ path: value });
						},
					},
				]
			: [];

		const settings = settingsRef.current;

		/** A command choosing between plain values, the one in effect marked. */
		const choice = (
			name: string,
			values: readonly string[],
			current: string | undefined,
			set: (value: string) => unknown,
		): CommandItem => ({
			name,
			value: name,
			choices: [
				{
					items: values.map((value) => ({
						name: value,
						value,
						active: value === current,
						run: () => set(value),
					})),
				},
			],
		});

		const webProviders =
			providersRef.current
				?.filter((provider) => provider.type === "web" && provider.status.valid)
				.map((provider) => provider.name) ?? [];

		const simpleSettings: CommandItem[] = [
			choice("theme", ThemeUtils.themes, settings.theme, (value) =>
				settings.setTheme.mutate({ theme: value as typeof settings.theme }),
			),
			choice(
				"code-theme",
				ThemeUtils.codeThemesByTheme[settings.theme],
				settings.codeTheme,
				(value) =>
					settings.setCodeTheme.mutate({
						codeTheme: value as typeof settings.codeTheme,
					}),
			),
			choice(
				"provider-cache",
				["on", "off"],
				onOff(settings.useProviderCache),
				(value) =>
					settings.setUseProviderCache.mutate({
						useProviderCache: value === "on",
					}),
			),
			choice(
				"browser-models",
				["on", "off"],
				onOff(settings.useBrowserModels),
				(value) =>
					settings.setUseBrowserModels.mutate({
						useBrowserModels: value === "on",
					}),
			),
			choice(
				"smart-search",
				["on", "off"],
				onOff(settings.useEmbeddingSearch),
				(value) => {
					// Search runs on embeddings, so there is nothing to turn on without a model.
					if (!settings.embeddingConfig) return;
					settings.setUseEmbeddingSearch.mutate({
						useEmbeddingSearch: value === "on",
					});
				},
			),
			choice(
				"memory-budget",
				MEMORY_BUDGETS.map(String),
				String(settings.memoryBudget),
				(value) =>
					settings.setMemoryBudget.mutate({
						project: settings.project,
						tokens: Number(value),
					}),
			),
			choice(
				"web-provider",
				webProviders,
				settings.preferredWebProvider ?? undefined,
				(value) =>
					settings.setPreferredWebProvider.mutate({
						preferredWebProvider: value,
					}),
			),
		];

		const navigation: CommandItem[] = [
			{
				name: "projects",
				value: "projects",
				run: () => onOpenProjectsRef.current?.(),
			},
			{
				name: "chats",
				value: "chats",
				run: () => onOpenChatsRef.current?.(),
			},
			...(onOpenFilesRef.current
				? [
						{
							name: "files",
							value: "files",
							run: () => onOpenFilesRef.current?.(),
						},
					]
				: []),
			{
				name: "settings",
				value: "settings",
				run: () => onOpenSettingsRef.current?.(),
			},
			...(onOpenConsoleRef.current
				? [
						{
							name: "console",
							value: "console",
							run: () => onOpenConsoleRef.current?.(),
						},
					]
				: []),
		];

		return [
			{
				name: "Commands",
				items: [
					...commandsRef.current,
					...navigation,
					...simpleSettings,
					{
						name: "clear",
						value: "clear",
						run: () => {
							ChatService.setChat({ id: null });
						},
					},
					{ name: "model", value: "model", choices: models },
					...modelArgs,
					{
						name: "reload",
						value: "reload",
						run: () => {
							updateProvidersRef.current.mutate({});
							void localSkillsRef.current.refetch();
							refreshMcpServersRef.current.mutate({});
						},
					},
					{
						name: "set-preset",
						value: "set-preset",
						dynamic: true,
						run: (value) => {
							if (!value) return;
							setPresetRef.current.mutate({
								name: value,
								config: configRef.current,
							});
						},
					},
					{
						name: "unset-preset",
						value: "unset-preset",
						choices: presets,
					},
					{
						name: "preset",
						value: "preset",
						choices: presets,
					},
					{ name: "system-prompt", value: "system-prompt", dynamic: true },
					...capabilities,
					...userData,
					...uploads,
					...shell,
				],
			},
			{
				name: "Skills",
				items: skills,
			},
		];
	}, []);

	return { getCommands };
};
