import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { GitService } from "#client/features/chat/services/GitService.ts";
import type { GitRepo } from "#client/features/chat/types/chatFiles.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/** The uncommitted text change to a file on the machine, in whichever repo has it. */
const findChange = ({
	file,
	repos,
}: {
	file: { path: string; directory: boolean; local: boolean };
	repos: GitRepo[];
}) => {
	if (!file.local || file.directory) return null;
	const path = PathUtils.normalize({ path: file.path, unix: true });
	for (const repo of repos) {
		const change = repo.changes.find((change) => change.path === path);
		if (change && !change.binary) return { repo, change };
	}
	return null;
};

/**
 * A file on the machine against its last commit, or null when git has nothing
 * to show for it: it is not in a repository, has not changed, is binary, or is
 * too large to have been read whole.
 */
export const useFileDiff = ({
	file,
	repos,
}: {
	file: { path: string; directory: boolean; local: boolean };
	repos: GitRepo[];
}) => {
	const client = useContext(ClientContext);
	const shell = client.shell;

	// Only its values key the query, so it needs no memo of its own.
	const found = findChange({ file, repos });

	return useQuery({
		queryKey: [
			"useFileDiff",
			file.path,
			found?.change.additions,
			found?.change.deletions,
		],
		queryFn: async () => {
			if (!shell || !found) return null;
			const [before, after] = await Promise.all([
				GitService.original({ shell, ...found }),
				shell.readFile({ path: file.path }),
			]);
			const text = FileUtils.getTextFromBytes({ data: after.data });
			if (before === null || text === null) return null;
			return { before, after: text };
		},
		enabled: !!shell && !!found,
	});
};
