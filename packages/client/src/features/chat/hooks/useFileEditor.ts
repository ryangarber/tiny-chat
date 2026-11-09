import { useMutation } from "@tanstack/react-query";
import { useCallback, useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useChatFiles } from "#client/features/chat/hooks/useChatFiles.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/**
 * Writes a file shown in the chat's sources back to where it was read from,
 * then has its preview, its diff and its repository's changes read again.
 * `save` is left out for a file that cannot be written: see
 * {@link ChatSourcesUtils.editable}.
 */
export const useFileEditor = ({
	file,
}: {
	file: { path: string; directory: boolean };
}) => {
	const client = useContext(ClientContext);
	const { filesystem } = useChatFiles();

	const editable = ChatSourcesUtils.editable({
		file,
		chatId: filesystem.chat,
		hasShell: !!client.shell,
	});

	const write = useMutation({
		mutationFn: async (content: string) => {
			if (PathUtils.isMounted(file)) {
				await client.api.file.writeFile.mutate({
					...filesystem,
					path: file.path,
					content,
				});
			} else {
				if (!client.shell) throw new Error("local files not available");
				await client.shell.writeFile({ path: file.path, content });
			}
		},
		onSuccess: () =>
			Promise.all([
				client.queryClient.invalidateQueries({
					queryKey: ["useFileViewer", "data", file.path],
				}),
				client.queryClient.invalidateQueries({
					queryKey: ["useFileDiff", file.path],
				}),
				client.queryClient.invalidateQueries({
					queryKey: ["useChatSources", "status"],
				}),
			]),
	});

	const { mutateAsync } = write;
	const save = useCallback(
		async (content: string) => {
			await mutateAsync(content);
		},
		[mutateAsync],
	);

	return { save: editable ? save : undefined };
};
