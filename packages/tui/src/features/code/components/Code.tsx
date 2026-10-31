import { useContext, useMemo } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import Content from "#tui/core/components/Content.tsx";
import Text, { InsideTextContext } from "#tui/core/components/Text.tsx";
import { TuiUtils } from "#tui/core/utils/TuiUtils.ts";
import CodeLines from "#tui/features/code/components/CodeLines.tsx";
import Highlight from "#tui/features/code/components/Highlight.tsx";

export const Code = ({
	code,
	filename,
	language,
	startLine = 1,
	lineNumbers = true,
	maxHeight,
	incomplete = false,
	...props
}: Omit<Parameters<typeof Highlight>[0], "code"> & {
	code: string;
	filename?: string;
	language?: string | null;
	startLine?: number;
	lineNumbers?: boolean;
	maxHeight?: number;
	/** The code is still streaming in. */
	incomplete?: boolean;
}) => {
	// tabs are expanded before highlighting so the tokens Ink measures are the
	// same width the terminal draws; and only as many lines as are shown are
	const displayed = useMemo(() => TuiUtils.display(code), [code]);
	const insideText = useContext(InsideTextContext);

	const { highlighted } = useCode({
		code: displayed,
		language: language ?? null,
		incomplete,
	});

	// Inside text — a block of code in a link or a heading — there is no box to
	// draw its lines in, so it runs on as inline code.
	if (insideText) {
		return (
			<Text color="textSubtle" backgroundColor="interior">
				{displayed}
			</Text>
		);
	}

	return (
		<Content
			formatter={() => code}
			streaming={incomplete}
			findLabel={filename ?? (language ? `${language} code` : "code")}
			backgroundColor={highlighted.bg}
			maxHeight={maxHeight}
		>
			<Highlight code={highlighted} filename={filename} {...props}>
				<CodeLines
					code={highlighted}
					language={language}
					lineNumbers={lineNumbers}
					startLine={startLine}
				/>
			</Highlight>
		</Content>
	);
};
