import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useLatestCallback } from "#client/core/hooks/useLatestCallback.ts";
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

	const { session } = useSession();
	const isAnonymous =
		!session.data?.user || session.data.user.isAnonymous === true;

	// The chats most recently written in, across projects, and the newest
	// projects, as far as the list has been loaded.
	const { projects: chatList } = useChatList();
	const pages = chatList.data?.pages ?? [];
	const recentChats = pages
		.flatMap((page) => [
			...page.chats,
			...page.projects.flatMap((project) => project.chats),
		])
		.sort((a, b) => ChatUtils.getTimestamp(b) - ChatUtils.getTimestamp(a))
		.slice(0, RECENTS);
	const recentProjects = pages
		.flatMap((page) => page.projects)
		.slice(0, RECENTS);

	// Built from what this render holds, so a host rendering the list shows
	// what is in effect now; the compiler rebuilds it only when that changes.
	const groups = ((): CommandGroup[] => {
		const models: CommandChoiceGroup[] =
			providers.data
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
							config.provider === provider.name && config.model === model.name,
						run: () =>
							setModel({
								provider: provider.name,
								model: model.name,
							}),
					})),
				})) ?? [];

		const argItems: CommandItem[] = modelArgs.flatMap((arg) => {
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
									config.args?.[arg.name] === value ||
									(!config.args?.[arg.name] && arg.default === value),
								run: () => setModelArg(arg.name, value),
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
						setModelArg(arg.name, int);
					},
				};
			}
			return [];
		});

		const presetChoices: CommandChoiceGroup[] = [
			{
				items: Object.entries(presets ?? {}).map(([name, preset]) => ({
					name,
					value: name,
					run: (command) => {
						if (command.name === "preset") {
							setConfig(preset);
						} else if (command.name === "unset-preset") {
							unsetPreset.mutate({
								name,
							});
						}
					},
				})),
			},
		];

		const skillItems: CommandItem[] = skills.map((skill) => ({
			name: skill.name,
			value: `skill:${skill.path}`,
		}));

		/** A command the host runs, offered only where it has one. */
		const hosted = (name: string, run?: () => void): CommandItem[] =>
			run ? [{ name, value: name, run: () => run() }] : [];

		// Only offered where the host has somewhere to open them.
		const uploads: CommandItem[] = [
			...hosted("uploads", onOpenUploads),
			...hosted("github", onOpenGitHub),
		];

		// What the user is remembered by and has scheduled, across their chats.
		const userData: CommandItem[] = [
			...hosted("memories", onOpenMemories),
			...hosted("actions", onOpenActions),
		];

		const app: CommandItem[] = [
			...(update ? hosted("update", update.install) : []),
			...(isAnonymous
				? hosted("login", onLogin)
				: hosted("logout", async () => {
						await client.auth.signOut();
						onLogout?.();
					})),
			...hosted("quit", onQuit),
		];

		const shell: CommandItem[] = client.shell?.chdir
			? [
					{
						name: "cd",
						value: "cd",
						dynamic: true,
						run: async (value) => {
							if (!value) return;
							await client.shell?.chdir?.({ path: value });
						},
					},
				]
			: [];

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
			providers.data
				?.filter((provider) => provider.type === "web" && provider.status.valid)
				.map((provider) => provider.name) ?? [];

		const simpleSettings: CommandItem[] = [
			choice("theme", ThemeUtils.themes, theme, (value) =>
				setTheme.mutate({ theme: value as typeof theme }),
			),
			choice(
				"code-theme",
				ThemeUtils.codeThemesByTheme[theme],
				codeTheme,
				(value) =>
					setCodeTheme.mutate({
						codeTheme: value as typeof codeTheme,
					}),
			),
			choice(
				"provider-cache",
				["on", "off"],
				onOff(useProviderCache),
				(value) =>
					setUseProviderCache.mutate({
						useProviderCache: value === "on",
					}),
			),
			choice(
				"browser-models",
				["on", "off"],
				onOff(useBrowserModels),
				(value) =>
					setUseBrowserModels.mutate({
						useBrowserModels: value === "on",
					}),
			),
			choice(
				"smart-search",
				["on", "off"],
				onOff(useEmbeddingSearch),
				(value) => {
					// Search runs on embeddings, so there is nothing to turn on without a model.
					if (!embeddingConfig) return;
					setUseEmbeddingSearch.mutate({
						useEmbeddingSearch: value === "on",
					});
				},
			),
			choice(
				"memory-budget",
				MEMORY_BUDGETS.map(String),
				String(memoryBudget),
				(value) =>
					setMemoryBudget.mutate({
						project: project,
						tokens: Number(value),
					}),
			),
			choice(
				"web-provider",
				webProviders,
				preferredWebProvider ?? undefined,
				(value) =>
					setPreferredWebProvider.mutate({
						preferredWebProvider: value,
					}),
			),
		];

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
								active: project === null,
								run: () => ChatService.newChat(null),
							},
							...recentProjects.map((recent) => ({
								name: recent.title || "Untitled",
								value: recent.id,
								active: project?.id === recent.id,
								run: () => ChatService.newChat(recent),
							})),
							more(() => onOpenProjects()),
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
							...recentChats.map((recent) => ({
								name: recent.title || "Untitled",
								value: recent.id,
								active: chat.data?.id === recent.id,
								run: () => ChatService.setChat(recent),
							})),
							more(() => onOpenChats()),
						],
					},
				],
			},
			...hosted("files", onOpenFiles),
			...hosted("settings", onOpenSettings),
			...hosted("config", onOpenConfig),
			...hosted("console", onOpenConsole),
		];

		return [
			{
				name: "Commands",
				items: [
					...commands,
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
					...argItems,
					{
						name: "reload",
						value: "reload",
						run: () => {
							updateProviders.mutate({});
							void localSkills.refetch();
							refreshMcpServers.mutate({});
						},
					},
					{
						name: "set-preset",
						value: "set-preset",
						dynamic: true,
						run: (value) => {
							if (!value) return;
							setPreset.mutate({
								name: value,
								config: config,
							});
						},
					},
					{
						name: "unset-preset",
						value: "unset-preset",
						choices: presetChoices,
					},
					{
						name: "preset",
						value: "preset",
						choices: presetChoices,
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
				items: skillItems,
			},
		];
	})();

	// For a host that takes the list in once and asks for it when it is needed.
	const getCommands = useLatestCallback(() => groups);

	return { commands: groups, getCommands };
};
