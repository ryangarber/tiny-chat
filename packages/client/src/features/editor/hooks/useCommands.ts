import { useCallback, useContext, useRef } from "react";
import { ClientContext } from "#client/client.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { useConfig } from "#client/features/agent/hooks/useConfig.ts";
import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import { useSkills } from "#client/features/agent/hooks/useSkills.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type {
	CommandChoiceGroup,
	CommandChoiceItem,
	CommandGroup,
	CommandItem,
} from "#client/features/editor/types/command.ts";
import { useEmbeddingSettings } from "#client/features/settings/hooks/useEmbeddingSettings.ts";
import { useInstructions } from "#client/features/settings/hooks/useInstructions.ts";
import { usePresets } from "#client/features/settings/hooks/usePresets.ts";
import { useProviderSettings } from "#client/features/settings/hooks/useProviderSettings.ts";
import { useThemes } from "#client/features/settings/hooks/useThemes.ts";
import { ThemeUtils } from "#core/core/utils/ThemeUtils.ts";
import type {
	ChatState,
	ProjectState,
} from "#core/features/data/types/chat.ts";
import { ChatUtils } from "#core/features/data/utils/ChatUtils.ts";
import type { ModelProviderStatus } from "#core/features/provider/types/model.ts";
import type { ProviderState } from "#core/features/provider/types/provider.ts";

/** The budgets the memory can be filled up to, as the app's slider steps. */
const MEMORY_BUDGETS = Array.from({ length: 21 }, (_, i) => i * 500);

const onOff = (value: boolean) => (value ? "on" : "off");

/** How many recent chats and projects are offered before the full list. */
const RECENTS = 10;

/** The choice that opens the full list, after the recents. */
const MORE = "more…";

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
	onOpenUploads,
	onOpenGitHub,
	onOpenMemories,
	onOpenActions,
	onOpenConsole,
	onQuit,
	onLogin,
	onLogout,
	update,
}: {
	commands?: CommandItem[];
	onOpenSettings: () => void;
	/** The full list of chats, past the recents offered as choices. */
	onOpenChats: () => void;
	onOpenFiles?: () => void;
	/** The full list of projects, past the recents offered as choices. */
	onOpenProjects: () => void;
	onOpenConfig: () => void;
	onOpenUploads?: () => void;
	onOpenGitHub?: () => void;
	onOpenMemories: () => void;
	onOpenActions: () => void;
	onOpenConsole?: () => void;
	/** Where the host can be quit from inside it. */
	onQuit?: () => void;
	/** Links an anonymous user to an account. */
	onLogin?: () => void;
	/** After signing out. */
	onLogout?: () => void;
	/** A release of the host waiting to be installed. */
	update?: { version: string; install: () => void };
}) => {
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

	// What the host does for a command, read when the command runs.
	const hostRef = useRef({
		onOpenSettings,
		onOpenChats,
		onOpenFiles,
		onOpenProjects,
		onOpenConfig,
		onOpenUploads,
		onOpenGitHub,
		onOpenMemories,
		onOpenActions,
		onOpenConsole,
		onQuit,
		onLogin,
		onLogout,
		update,
	});
	hostRef.current = {
		onOpenSettings,
		onOpenChats,
		onOpenFiles,
		onOpenProjects,
		onOpenConfig,
		onOpenUploads,
		onOpenGitHub,
		onOpenMemories,
		onOpenActions,
		onOpenConsole,
		onQuit,
		onLogin,
		onLogout,
		update,
	};

	const { session } = useSession();
	const isAnonymousRef = useRef(true);
	isAnonymousRef.current =
		!session.data?.user || session.data.user.isAnonymous === true;

	// The chats most recently written in, across projects, and the newest
	// projects, as far as the list has been loaded.
	const { projects: chatList } = useChatList();
	const recentsRef = useRef({
		chats: [] as ChatState[],
		projects: [] as ProjectState[],
	});
	const pages = chatList.data?.pages;
	recentsRef.current = {
		chats: (pages ?? [])
			.flatMap((page) => [
				...page.chats,
				...page.projects.flatMap((project) => project.chats),
			])
			.sort((a, b) => ChatUtils.getTimestamp(b) - ChatUtils.getTimestamp(a))
			.slice(0, RECENTS),
		projects: (pages ?? []).flatMap((page) => page.projects).slice(0, RECENTS),
	};

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

		const host = hostRef.current;

		/** A command the host runs, offered only where it has one. */
		const hosted = (name: string, run?: () => void): CommandItem[] =>
			run ? [{ name, value: name, run: () => run() }] : [];

		// Only offered where the host has somewhere to open them.
		const uploads: CommandItem[] = [
			...hosted("uploads", host.onOpenUploads),
			...hosted("github", host.onOpenGitHub),
		];

		// What the user is remembered by and has scheduled, across their chats.
		const userData: CommandItem[] = [
			...hosted("memories", host.onOpenMemories),
			...hosted("actions", host.onOpenActions),
		];

		const app: CommandItem[] = [
			...(host.update ? hosted("update", host.update.install) : []),
			...(isAnonymousRef.current
				? hosted("login", host.onLogin)
				: hosted("logout", async () => {
						await clientRef.current.auth.signOut();
						hostRef.current.onLogout?.();
					})),
			...hosted("quit", host.onQuit),
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

		const recents = recentsRef.current;

		/**
		 * The full list, after the recents and ranked among them, so typing it
		 * finds it over a loose match on a title.
		 */
		const more = (run: () => void): CommandChoiceItem => ({
			name: MORE,
			value: MORE,
			run: () => run(),
		});

		const navigation: CommandItem[] = [
			{
				name: "projects",
				value: "projects",
				choices: [
					{
						name: "Recent",
						items: [
							{
								name: "(none)",
								value: "(none)",
								active: settings.project === null,
								run: () => ChatService.newChat(null),
							},
							...recents.projects.map((project) => ({
								name: project.title || "Untitled",
								value: project.id,
								active: settings.project?.id === project.id,
								run: () => ChatService.newChat(project),
							})),
							more(() => hostRef.current.onOpenProjects()),
						],
					},
				],
			},
			{
				name: "chats",
				value: "chats",
				choices: [
					{
						name: "Recent",
						items: [
							...recents.chats.map((chat) => ({
								name: chat.title || "Untitled",
								value: chat.id,
								active: chatRef.current?.id === chat.id,
								run: () => ChatService.setChat(chat),
							})),
							more(() => hostRef.current.onOpenChats()),
						],
					},
				],
			},
			...hosted("files", host.onOpenFiles),
			...hosted("settings", host.onOpenSettings),
			...hosted("config", host.onOpenConfig),
			...hosted("console", host.onOpenConsole),
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
					...userData,
					...uploads,
					...shell,
					...app,
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
