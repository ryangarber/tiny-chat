import {
	ActionIcon,
	Badge,
	Card,
	Center,
	Group,
	ScrollArea,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import {
	ArrowClockwiseIcon,
	CloudArrowDownIcon,
	MagnifyingGlassIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { ClientContext } from "#client/client.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useUploads } from "#client/features/upload/hooks/useUploads.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import Sentinel from "#gui/core/components/Sentinel.tsx";

export function GitHubUploads({ close }: { close: () => void }) {
	const client = useContext(ClientContext);

	// Logic from GitHub.tsx
	const [search, setSearch] = useState("");

	const repos = useQuery({
		...client.query.upload.getGitHubRepositories.queryOptions(),
		select: (data) =>
			[
				...data.filter((p) =>
					p.full_name.toLowerCase().includes(search.toLowerCase().trim()),
				),
			].sort(
				(a, b) =>
					new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
			),
	});

	const { githubUploads, deleteUpload, cloneGitHubRepository } = useUploads();

	return (
		<Stack h="100%" gap="md">
			<TextInput
				placeholder="Search repositories…"
				leftSection={<MagnifyingGlassIcon size={16} />}
				value={search}
				onChange={(e) => setSearch(e.currentTarget.value)}
			/>

			{repos.isError ? (
				<Text size="sm" c="red" ta="center">
					{repos.error?.message}
				</Text>
			) : (
				<ScrollArea h={400}>
					<Stack gap="xs">
						{repos.data?.length === 0 && (
							<Center py={20}>
								<Text size="sm" c="dimmed">
									No repositories found
								</Text>
							</Center>
						)}
						{repos.data?.map((repo) => {
							const [owner, repoName] = repo.full_name.split("/");
							const existing = githubUploads.data?.find(
								(u) =>
									u.repoName === repo.full_name &&
									u.branch === repo.default_branch,
							);

							const isMutating =
								cloneGitHubRepository.variables?.owner === owner &&
								cloneGitHubRepository.variables?.repository === repoName &&
								cloneGitHubRepository.variables?.branch === repo.default_branch;
							const isCloning = isMutating
								? cloneGitHubRepository.isPending
								: false;
							const cloneError = isMutating
								? cloneGitHubRepository.error
								: undefined;

							return (
								<Card
									key={repo.id}
									p="xs"
									withBorder
									style={{
										cursor: existing ? "pointer" : "default",
									}}
									onClick={() => {
										if (!existing) return;
										ComposerService.attachUpload({
											client,
											upload: existing,
										});
										close();
									}}
								>
									<Group justify="space-between" wrap="nowrap" gap="xs">
										<Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
											<Group gap={6} wrap="nowrap">
												<Text size="sm" fw={500} truncate>
													{repo.full_name}
												</Text>
												{repo.private && (
													<Badge size="xs" variant="light" color="gray">
														private
													</Badge>
												)}
											</Group>
											{repo.description && (
												<Text size="xs" c="dimmed" truncate>
													{repo.description}
												</Text>
											)}
											{cloneError && (
												<Text size="xs" c="red" truncate>
													{cloneError instanceof Error
														? cloneError.message
														: "Unknown error"}
												</Text>
											)}
											<Group gap={6} wrap="nowrap">
												<Text size="xs" c="dimmed" flex="0 0 auto">
													Last commit{" "}
													{CommonUtils.formatDate({
														date: new Date(repo.updated_at),
														relative: true,
													})}
												</Text>
											</Group>
										</Stack>
										<Stack gap={4} align="end">
											<Group gap={0} wrap="nowrap">
												{existing && (
													<ActionIcon
														variant="subtle"
														color="red"
														onClick={(e) => {
															e.stopPropagation();
															deleteUpload.mutate({ id: existing.id });
														}}
														loading={
															deleteUpload.isPending &&
															deleteUpload.variables.id === existing.id
														}
														disabled={
															deleteUpload.isPending &&
															deleteUpload.variables.id === existing.id
														}
													>
														<TrashIcon size={18} />
													</ActionIcon>
												)}
												<ActionIcon
													variant="subtle"
													color="dimmed"
													onClick={(e) => {
														e.stopPropagation();
														cloneGitHubRepository.mutate({
															owner,
															repository: repoName,
															branch: repo.default_branch,
														});
													}}
													loading={isCloning}
													disabled={isCloning}
												>
													{existing ? (
														<ArrowClockwiseIcon size={18} />
													) : (
														<CloudArrowDownIcon size={18} />
													)}
												</ActionIcon>
											</Group>
											{existing && (
												<Text size="xs" c="dimmed" truncate>
													{CommonUtils.formatDate({
														date: existing.createdAt,
														relative: true,
													})}
												</Text>
											)}
										</Stack>
									</Group>
								</Card>
							);
						})}
						<Sentinel isFetching={repos.isFetching} />
					</Stack>
				</ScrollArea>
			)}
		</Stack>
	);
}
