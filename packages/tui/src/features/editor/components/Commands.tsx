import { useApp } from "ink";
import { useCallback, useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { useCommands } from "#client/features/editor/hooks/useCommands.ts";
import type {
	CommandChoiceGroup,
	CommandChoiceItem,
	CommandEdit,
	CommandGroup,
	CommandItem,
} from "#client/features/editor/types/command.ts";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import { CommandUtils } from "#client/features/editor/utils/CommandUtils.ts";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import Completions from "#tui/features/editor/components/Completions.tsx";
import { useUpdate } from "#tui/features/update/hooks/useUpdate.ts";

export default function Commands({
	content,
	setContent,
	cursor,
	setCursor,
}: {
	content: string;
	setContent: (content: string) => void;
	cursor: [row: number, column: number];
	setCursor: (cursor: [row: number, column: number]) => void;
}) {
	const client = useContext(ClientContext);
	const { exit } = useApp();

	const { requestClone } = useSession();
	const { update, doUpdate } = useUpdate();

	const setFocus = useAppStore((state) => state.setFocus);
	const togglePanel = useAppStore((state) => state.togglePanel);
	const openPanel = useAppStore((state) => state.openPanel);
	const setStatus = useAppStore((state) => state.setStatus);
	const unsetStatus = useAppStore((state) => state.unsetStatus);

	const version = update.data;

	const { getCommands } = useCommands({
		onOpenSettings: () => setFocus("settings"),
		onOpenChats: () => openPanel("chats"),
		onOpenFiles: () => togglePanel("files"),
		onOpenProjects: () => openPanel("chats"),
		onOpenConfig: () => setFocus("config"),
		onOpenUploads: () => setFocus("uploads"),
		onOpenGitHub: () => setFocus("github"),
		onOpenMemories: () => setFocus("memories"),
		onOpenActions: () => setFocus("actions"),
		onOpenConsole: () => setFocus("console"),
		onQuit: () => exit(),
		onLogin: () =>
			requestClone.mutate(
				(id) => {
					ClipboardService.copy(`${client.webUrl}#/?clone=${id}`);
					setStatus({
						id: "clone",
						text: "Waiting for you to sign in...",
					});
				},
				{ onSettled: () => unsetStatus({ id: "clone" }) },
			),
		// Offered only once there is a release to take, which is also the only
		// time the status announcing it points here.
		update: version
			? { version, install: () => doUpdate.mutate(version) }
			: undefined,
	});

	const commands = getCommands();
	const query = CommandUtils.query({ content, cursor, groups: commands });

	const commandGroups =
		!query || query.command
			? []
			: CommandUtils.filter({ groups: commands, query: query.text });

	const choiceGroups = CommandUtils.filterChoices({
		command: query?.command ?? null,
		query: query?.text,
	});

	const groups: CompletionGroup[] = query?.command
		? choiceGroups
		: commandGroups;

	const apply = useCallback(
		(edit: CommandEdit | null) => {
			if (!edit) return false;
			setContent(edit.content);
			setCursor(edit.cursor);
			return true;
		},
		[setContent, setCursor],
	);

	if (!query) return null;

	if (query.command) {
		return (
			<Completions<CommandChoiceGroup, CommandChoiceItem>
				groups={groups}
				renderEmpty={() => {
					return "no matches";
				}}
				onInput={({ item, key }) => {
					if (key.return && !item) {
						apply(CommandUtils.applyContent({ content, query }));
					}
					if (key.return && item) {
						apply(
							CommandUtils.applyChoice({
								content,
								query,
								choice: item,
								complete: false,
							}),
						);
					}
					if (key.tab && item) {
						apply(
							CommandUtils.applyChoice({
								content,
								query,
								choice: item,
								complete: true,
							}),
						);
					}
				}}
				actions={[{ key: "tab", name: "fill" }, "select"]}
			/>
		);
	} else {
		return (
			<Completions<CommandGroup, CommandItem>
				groups={groups}
				renderItem={({ item }) => {
					return `/${item.name ?? item.value}`;
				}}
				renderEmpty={() => {
					return "no matches";
				}}
				onInput={({ key, item }) => {
					if (key.return && item) {
						apply(
							CommandUtils.applyCommand({
								content,
								query,
								command: item,
								complete: false,
							}),
						);
					}
					if (key.tab && item) {
						apply(
							CommandUtils.applyCommand({
								content,
								query,
								command: item,
								complete: true,
							}),
						);
					}
				}}
				actions={[{ key: "tab", name: "fill" }, "select"]}
			/>
		);
	}
}
