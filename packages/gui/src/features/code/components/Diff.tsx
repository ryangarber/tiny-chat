import { useCallback, useMemo, useState } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import { DiffUtils } from "#core/features/file/utils/DiffUtils.ts";
import Content, {
	type ContentFormats,
	type ContentFormatterFunction,
} from "#gui/core/components/Content.tsx";
import DiffLines from "#gui/features/code/components/DiffLines.tsx";
import Highlight from "#gui/features/code/components/Highlight.tsx";

export default function Diff({
	before,
	after,
	language,
	filename,
	fillHeight = false,
	...props
}: Omit<Parameters<typeof Content>[0], "code"> & {
	before: string;
	after: string;
	language?: string;
	filename?: string;
	fillHeight?: boolean;
}) {
	const [expanded, setExpanded] = useState<number[]>([]);

	const { highlighted: baseHighlight } = useCode({ code: "", language });

	const diff = useMemo(
		() => DiffUtils.context(DiffUtils.diff({ before, after })),
		[before, after],
	);

	const formats = useMemo<ContentFormats>(() => {
		return ["Before", "After"];
	}, []);

	const formatter = useCallback<ContentFormatterFunction>(
		async (format) => {
			return {
				filename,
				mime: "text/plain",
				data: format === "Before" ? before : after,
			};
		},
		[before, after, filename],
	);

	return (
		<Content
			formats={formats}
			formatter={formatter}
			findLabel={filename ? `Changes to ${filename}` : "Changes"}
			findText={() => DiffUtils.lines(diff)}
			{...props}
		>
			<Highlight
				highlight={baseHighlight}
				language={language ?? ""}
				filename={filename}
				lineNumbers={false}
				fillHeight={fillHeight}
			>
				<DiffLines
					diff={diff}
					expanded={expanded}
					setExpanded={setExpanded}
					language={language ?? ""}
				/>
			</Highlight>
		</Content>
	);
}
