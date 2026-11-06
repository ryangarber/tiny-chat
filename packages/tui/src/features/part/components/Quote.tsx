import type { ReactNode } from "react";
import { SourceUtils } from "#core/features/data/utils/SourceUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import Box from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";

export default function Quote({
	model,
	source,
	children,
}: {
	model?: string;
	/** What it was quoted from: a file's path, or `web:` and a URL. */
	source?: string;
	children: ReactNode;
}) {
	return (
		<Box paddingLeft={2} flexDirection="column">
			{!!model && <Text bold>💬 {model}</Text>}
			{!model && !!source && (
				<Text bold>
					{SourceUtils.getTypeEmoji(source.startsWith("web:") ? "web" : "file")}{" "}
					{PathUtils.name(source)}
				</Text>
			)}
			<Box flexDirection="column" gap={1}>
				{children}
			</Box>
		</Box>
	);
}
