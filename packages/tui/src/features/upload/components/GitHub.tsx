import { useQuery } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import type {
	CompletionGroup,
	CompletionItem,
} from "#client/features/editor/types/completion.ts";
import { useUploads } from "#client/features/upload/hooks/useUploads.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import Completions from "#tui/core/components/Completions.tsx";
import Text from "#tui/core/components/Text.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";

interface GitHubItem extends CompletionItem {
	detail?: string;
	error?: unknown;
	/** Whether there is a clone of the default branch to attach. */
	cloned: boolean;
	attach: () => Promise<void> | void;
	clone: () => Promise<void> | void;
	remove: () => void;
}

/**
 * The GitHub repositories the account can reach, and the clones of them the
 * next message can be sent with.
 *
 * A clone is attached by referencing its directory on the chat mount, so
 * picking one writes that reference into the editor.
 *
 * GitHub hands over every repository at once, so the list is grown a page at a
 * time as it is read rather than fetched a page at a time.
 */
export default function GitHub() {
	const client = useContext(ClientContext);

	const { githubUploads, deleteUpload, cloneGitHubRepository } = useUploads();

	const repos = useQuery({
		...client.query.upload.getGitHubRepositories.queryOptions(),
		select: (data) =>
			[...data].sort(
				(a, b) =>
					new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
			),
	});

	const { setPage } = usePage();

	useWorkingStatus(repos, githubUploads, cloneGitHubRepository, deleteUpload);

	const groups = useMemo((): CompletionGroup<GitHubItem>[] => {
		return [
			{
				items: (repos.data ?? []).map((repo) => {
					const [owner, repository] = repo.full_name.split("/");

					const existing = githubUploads.data?.find(
						(upload) =>
							upload.repoName === repo.full_name &&
							upload.branch === repo.default_branch,
					);

					// The mutation only ever holds the last repository it was asked
					// for, so its state belongs to that one alone.
					const mutating =
						cloneGitHubRepository.variables?.owner === owner &&
						cloneGitHubRepository.variables?.repository === repository;

					const cloning = mutating && cloneGitHubRepository.isPending;

					const detail = cloning
						? "cloning..."
						: existing
							? `cloned ${CommonUtils.formatDate({ date: existing.createdAt, relative: true })}`
							: "not cloned";

					return {
						name: repo.full_name,
						value: String(repo.id),
						detail,
						cloned: !!existing,
						error: mutating ? cloneGitHubRepository.error : undefined,
						attach: () => {
							if (!existing) return;
							ComposerService.attachUpload({ client, upload: existing });
							setPage("chat");
						},
						clone: () => {
							cloneGitHubRepository.mutate({
								owner,
								repository,
								branch: repo.default_branch,
							});
						},
						remove: () => {
							if (!existing) return;
							deleteUpload.mutate({ id: existing.id });
						},
					};
				}),
			},
		];
	}, [
		repos.data,
		githubUploads.data,
		cloneGitHubRepository,
		deleteUpload,
		setPage,
		client,
	]);

	return (
		<Completions<CompletionGroup<GitHubItem>, GitHubItem>
			groups={groups}
			renderItem={({ item }) => {
				return (
					<Text color={item.error ? "redBright" : undefined}>
						{item.name}
						<Text color={item.error ? "redBright" : "textSubtle"}>
							{item.error
								? ` · ${CommonUtils.formatError({ error: item.error })}`
								: ` · ${item.detail}`}
						</Text>
					</Text>
				);
			}}
			renderEmpty={() =>
				repos.error
					? CommonUtils.formatError({ error: repos.error })
					: "nothing here yet"
			}
			bindings={{
				// A repository is cloned before it can be attached.
				primary: {
					name: (item) => (item.cloned ? "attach" : "clone"),
					run: (item) => (item.cloned ? item.attach() : item.clone()),
				},
				remove: {
					name: "delete",
					run: (item) => item.remove(),
					when: (item) => item.cloned,
				},
				refresh: { run: () => repos.refetch() },
			}}
			actions={["back"]}
			selectFirstOnChange={false}
		/>
	);
}
