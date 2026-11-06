import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { UserService } from "#client/features/user/services/UserService.ts";
import type { Enum } from "#core/core/services/PostgresService.ts";

export const githubUploadsQueryKey = ["useUploads", "githubUploads"] as const;
export const uploadMutationKey = ["useUploads", "upload"] as const;

export const useUploads = () => {
	const client = useContext(ClientContext);

	const attachmentUploads = useInfiniteQuery({
		...client.query.upload.getUploads.infiniteQueryOptions(
			{ kind: "ATTACHMENT", limit: 10 },
			{
				getNextPageParam: (lastPage, _pages) => lastPage.nextCursor,
				select: (data) => ({
					pages: data.pages,
					pageParams: data.pageParams,
				}),
			},
		),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
	});

	const githubUploads = useQuery({
		queryKey: githubUploadsQueryKey,
		queryFn: async () => {
			const { uploads } = await client.api.upload.getUploads.query({
				kind: "GITHUB",
			});
			return uploads.flatMap((upload) => {
				if (!upload.name.includes("@")) {
					console.warn("[useUploads] GitHub upload has invalid name:", upload);
					return [];
				}
				return [
					{
						...upload,
						repoName: upload.name.split("@")[0].trim(),
						branch: upload.name.split("@")[1].trim(),
					},
				];
			});
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
		retry: false,
	});

	const upload = useMutation({
		mutationKey: uploadMutationKey,
		mutationFn: async ({
			kind,
			file,
		}: {
			kind: Enum["UploadKind"];
			file: File;
		}) => {
			const data = new FormData();
			data.set("kind", kind);
			data.set("file", file);
			return client.api.upload.createUpload.mutate(data);
		},
		onSuccess: async (result, variables) => {
			console.log("[useUploads] uploaded:", result);
			void attachmentUploads.refetch();
			void UserService.fetchNextEmbeddingBatch({ client });
			// A skill is carried by the message's config rather than its text, so
			// it is the one upload that is not written into the editor.
			if (variables.kind !== "SKILL") {
				ComposerService.attachUpload({
					client,
					upload: result,
					file: variables.file.name,
				});
			}
		},
	});

	const deleteUpload = useMutation({
		...client.query.upload.deleteUpload.mutationOptions(),
		onSuccess: () => {
			void attachmentUploads.refetch();
		},
	});

	const cloneGitHubRepository = useMutation({
		...client.query.upload.cloneGitHubRepository.mutationOptions(),
		onSuccess: () => {
			void githubUploads.refetch();
			void UserService.fetchNextEmbeddingBatch({ client });
		},
	});

	return {
		attachmentUploads,
		githubUploads,
		upload,
		deleteUpload,
		cloneGitHubRepository,
	};
};
