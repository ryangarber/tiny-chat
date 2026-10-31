import { useContext, useEffect, useRef } from "react";
import { ClientContext } from "#client/client.ts";
import { useChatList } from "#client/features/chat/hooks/useChatList.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import { WorktreeService } from "#core/features/file/services/WorktreeService.ts";
import { WorktreeUtils } from "#core/features/file/utils/WorktreeUtils.ts";

/**
 * Once the project list loads, selects the project with a folder most closely
 * holding the directory the runtime was launched in — or, launched in a git
 * worktree, the same directory in the worktree's main checkout. Folders sync across
 * devices, so any of a project's folders may be this device's copy. Does
 * nothing if a chat or project is already selected, and only ever runs once.
 */
export const useDefaultProject = () => {
	const client = useContext(ClientContext);
	const { projects } = useChatList();
	const done = useRef(false);

	useEffect(() => {
		const shell = client.shell;
		if (done.current || !projects.data || !shell?.cwd) return;
		const cwd = shell.cwd;
		done.current = true;

		const { active } = useChatStore.getState();
		if (active.chatId || active.project) return;

		const list = projects.data.pages.flatMap((page) => page.projects);
		/** The project with a folder most closely holding `path`. */
		const find = (path: string) => {
			// Folders are stored as picked; `path` is as the shell spells it.
			let match: { project: (typeof list)[number]; length: number } | null =
				null;
			for (const project of list) {
				for (const { path: picked } of project.settings?.folders ?? []) {
					const folder = shell.toShellPath?.({ path: picked }) ?? picked;
					if (
						SettingsUtils.contains({ folder, path }) &&
						folder.length > (match?.length ?? -1)
					)
						match = { project, length: folder.length };
				}
			}
			return match?.project;
		};
		void (async () => {
			const directory = await cwd();
			let project = find(directory);
			// A worktree belongs to the project its main checkout is in.
			if (!project) {
				const worktree = await WorktreeService.get({ shell, directory });
				const main =
					worktree && WorktreeUtils.toMain({ ...worktree, path: directory });
				if (main) project = find(main);
			}
			if (project && !useChatStore.getState().active.chatId)
				ChatService.newChat(project);
		})();
	}, [client, projects.data]);
};
