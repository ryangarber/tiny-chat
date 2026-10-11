/** biome-ignore-all lint/suspicious/noArrayIndexKey: nodes stay in order */

import { Text } from "ink";
import { useMemo } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import { DiffUtils } from "#core/features/file/utils/DiffUtils.ts";
import Content from "#tui/core/components/Content.tsx";
import { TuiUtils } from "#tui/core/utils/TuiUtils.ts";
import DiffLines from "#tui/features/code/components/DiffLines.tsx";
import Highlight from "#tui/features/code/components/Highlight.tsx";

export default function Diff({
	before,
	after,
	language,
	maxHeight,
	...props
}: Omit<Parameters<typeof Highlight>[0], "code"> & {
	before: string;
	after: string;
	language?: string | null;
	maxHeight?: number;
}) {
	// every line is drawn behind a two column marker, so tab stops start there
	const diff = useMemo(
		() =>
			DiffUtils.context(
				DiffUtils.diff({
					before: TuiUtils.display(before, 2),
					after: TuiUtils.display(after, 2),
				}),
			),
		[before, after],
	);

	const diffShown = useMemo(() => diff.slice(0, maxHeight), [diff, maxHeight]);
	const overflow = diff.length - diffShown.length;

	const { highlighted } = useCode({ code: "", language });

	// the app's first format is the file before the edit
	return (
		<Content formatter={() => after} backgroundColor={highlighted.bg}>
			<Highlight code={highlighted} {...props}>
				<DiffLines
					diff={diffShown}
					highlighted={highlighted}
					language={language}
				/>
				{overflow > 0 && <Text dimColor>{` ⋮ ${overflow} more lines`}</Text>}
			</Highlight>
		</Content>
	);
}
