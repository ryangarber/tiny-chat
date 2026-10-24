/** biome-ignore-all lint/suspicious/noArrayIndexKey: nodes stay in order */

import { Text } from "ink";
import { useMemo } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import Content from "#tui/core/components/Content.tsx";
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
	const { displayed, overflow } = useMemo(() => {
		const lines = TuiUtils.display(code).split("\n");
		const shown = maxHeight ? lines.slice(0, maxHeight) : lines;
		return {
			displayed: shown.join("\n"),
			overflow: lines.length - shown.length,
		};
	}, [code, maxHeight]);

	const { highlighted } = useCode({
		code: displayed,
		language: language ?? null,
		incomplete,
	});

	return (
		<Content
			formatter={() => code}
			streaming={incomplete}
			findLabel={filename ?? (language ? `${language} code` : "code")}
			backgroundColor={highlighted.bg}
		>
			<Highlight code={highlighted} filename={filename} {...props}>
				<CodeLines
					code={highlighted}
					language={language}
					lineNumbers={lineNumbers}
					startLine={startLine}
				/>
				{overflow > 0 && <Text dimColor>{` ⋮ ${overflow} more lines`}</Text>}
			</Highlight>
		</Content>
	);
};
