import { Box, Text } from "better-ink-ui";
import Spinner from "ink-spinner";
import { useShallow } from "zustand/react/shallow";
import { useEmbedding } from "#client/features/user/hooks/useEmbedding.ts";
import { type Status, useAppStore } from "#tui/core/stores/useAppStore.ts";

const WORKING: Status = { id: "working", text: "working" };

export default function StatusText() {
	const statuses = useAppStore(
		useShallow((state): Status[] => [
			...state.statuses,
			...(state.workingStatus.size > 0 ? [WORKING] : []),
		]),
	);

	const { embeddingStatus } = useEmbedding();

	return (
		<Box marginLeft={2} marginY={1} flexDirection="column">
			{!!embeddingStatus.batch && (
				<Box>
					<Text color="primary">
						<Spinner type="circleQuarters" />
						{` `}embedding ({embeddingStatus.totalCount})
					</Text>
				</Box>
			)}
			{statuses.map((status) => (
				<Box key={status.id}>
					<Text color="primary">
						{!status.passive && <Spinner type="circleQuarters" />}
						{status.text && (status.passive ? status.text : ` ${status.text}`)}
					</Text>
				</Box>
			))}
		</Box>
	);
}
