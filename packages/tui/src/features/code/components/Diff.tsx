import { useMemo } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import { DiffUtils } from "#core/features/file/utils/DiffUtils.ts";
import Content, { type ContentEdit } from "#tui/core/components/Content.tsx";
import { TuiUtils } from "#tui/core/utils/TuiUtils.ts";
import DiffLines from "#tui/features/code/components/DiffLines.tsx";
import Highlight from "#tui/features/code/components/Highlight.tsx";

export default function Diff({
	before,
	after,
	language,
	maxHeight,
	edit,
	contentId,
	...props
}: Omit<Parameters<typeof Highlight>[0], "code"> & {
	/** Edits the text after, which is what is on disk. */
	edit?: ContentEdit;
	contentId?: string;
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

	const { highlighted } = useCode({ code: "", language });

	// the app's first format is the file before the edit
	return (
		<Content
			formatter={() => after}
			edit={edit}
			contentId={contentId}
			backgroundColor={highlighted.bg}
			maxHeight={maxHeight}
		>
			<Highlight code={highlighted} {...props}>
				<DiffLines diff={diff} highlighted={highlighted} language={language} />
			</Highlight>
		</Content>
	);
}
