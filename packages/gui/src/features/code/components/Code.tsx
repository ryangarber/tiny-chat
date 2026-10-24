import { useDisclosure } from "@mantine/hooks";
import { useCallback, useMemo } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import Content, {
	type ContentFormatterFunction,
} from "#gui/core/components/Content.tsx";
import CodeLines from "#gui/features/code/components/CodeLines.tsx";
import Highlight from "#gui/features/code/components/Highlight.tsx";

export default function Code({
	code,
	language,
	filename,
	startLine = 1,
	lineNumbers = true,
	streaming,
	incomplete = false,
	fillHeight = false,
	...props
}: Parameters<typeof Content>[0] & {
	code: string;
	language?: string;
	filename?: string;
	startLine?: number;
	lineNumbers?: boolean;
	streaming?: boolean;
	/** This block's fence is still open: its code is streaming in. */
	incomplete?: boolean;
	fillHeight?: boolean;
}) {
	const { highlighted } = useCode({ code, language, incomplete });

	const disclosure = useDisclosure();

	const formats = useMemo(() => {
		return ["Original"];
	}, []);

	const formatter = useCallback<ContentFormatterFunction>(async () => {
		return {
			filename,
			mime: "text/plain",
			data: code,
		};
	}, [code, filename]);

	return (
		<Content
			formats={formats}
			formatter={formatter}
			streaming={streaming}
			findLabel={filename ?? (language ? `${language} code` : "Code")}
			data-streamdown="code-block"
			data-language={language}
			data-incomplete={incomplete || undefined}
			disclosure={disclosure}
			{...props}
		>
			<Highlight
				language={language ?? ""}
				filename={filename}
				lineNumbers={lineNumbers}
				startLine={startLine}
				highlight={highlighted}
				fillHeight={fillHeight || disclosure[0]}
			>
				<CodeLines
					code={highlighted}
					language={language}
					lineNumbers={lineNumbers}
				/>
			</Highlight>
		</Content>
	);
}
