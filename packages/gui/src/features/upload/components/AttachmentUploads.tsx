import {
	ActionIcon,
	Card,
	Group,
	ScrollArea,
	Stack,
	Text,
} from "@mantine/core";
import { TrashIcon } from "@phosphor-icons/react";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useUploads } from "#client/features/upload/hooks/useUploads.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import Sentinel from "#gui/core/components/Sentinel.tsx";
import { useSentinel } from "#gui/core/hooks/useSentinel.ts";
import SourceChip from "#gui/features/part/components/SourceChip.tsx";
import Dropzone from "#gui/features/upload/components/Dropzone.tsx";

export function AttachmentUploads({ close }: { close: () => void }) {
	const client = useContext(ClientContext);

	const { attachmentUploads, deleteUpload } = useUploads();
	const { viewportRef, sentinelRef } = useSentinel({
		query: attachmentUploads,
		queryKey: client.query.upload.getUploads.pathKey(),
	});

	return (
		<Stack h="100%">
			<Dropzone kind="ATTACHMENT" />
			<ScrollArea h={300} viewportRef={viewportRef}>
				<Stack gap="xs">
					{attachmentUploads.data?.pages.flatMap((page) => page.uploads)
						.length === 0 && (
						<Text size="sm" c="dimmed" ta="center" py="xl">
							No recent uploads
						</Text>
					)}
					{attachmentUploads.data?.pages
						.flatMap((page) => page.uploads)
						.map((upload) => (
							<Card
								key={upload.id}
								p="xs"
								withBorder
								style={{ cursor: "pointer" }}
								onClick={() => {
									void ComposerService.attachUpload({ client, upload });
									close();
								}}
							>
								<Group justify="space-between" wrap="nowrap" gap="xs">
									<SourceChip
										path={upload.name}
										directory={true}
										thumbnail={upload.thumbnail ?? undefined}
										size={30}
										style={{ minWidth: 0, flex: 1 }}
										gap={10}
										viewable={false}
									>
										<Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
											<Text
												size="sm"
												fw={500}
												style={{
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{upload.name}
											</Text>
											<Text size="xs" c="dimmed">
												{upload.createdAt
													? CommonUtils.formatDate({
															date: upload.createdAt,
															relative: true,
														})
													: ""}
											</Text>
										</Stack>
									</SourceChip>
									<ActionIcon
										variant="subtle"
										color="red"
										onClick={(e) => {
											e.stopPropagation();
											void deleteUpload.mutate({ id: upload.id });
										}}
										loading={
											deleteUpload.isPending &&
											deleteUpload.variables.id === upload.id
										}
										disabled={
											deleteUpload.isPending &&
											deleteUpload.variables.id === upload.id
										}
									>
										<TrashIcon size={18} />
									</ActionIcon>
								</Group>
							</Card>
						))}
					<Sentinel
						isFetching={attachmentUploads.isFetching}
						ref={sentinelRef}
					/>
				</Stack>
			</ScrollArea>
		</Stack>
	);
}
