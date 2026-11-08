/** biome-ignore-all lint/suspicious/noArrayIndexKey: code stays in order */

import { Text } from "@mantine/core";
import { type ReactNode, useMemo } from "react";
import type { CodeResult } from "#core/core/utils/CodeUtils.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

export default function Highlight({
	highlight,
	children,
	language,
	filename,
	startLine = 1,
	lineNumbers = true,
	fillHeight = false,
}: {
	highlight: CodeResult;
	children?: ReactNode;
	language: string;
	filename?: string;
	startLine?: number;
	lineNumbers?: boolean;
	fillHeight?: boolean;
}) {
	const preStyle = useMemo(() => {
		const style: Record<string, string> = {};

		if (highlight.bg) {
			style["--sdm-bg"] = highlight.bg;
		}
		if (highlight.fg) {
			style["--sdm-fg"] = highlight.fg;
		}

		if (highlight.rootStyle) {
			Object.assign(style, CommonUtils.toStyleObject(highlight.rootStyle));
		}

		return style;
	}, [highlight.bg, highlight.fg, highlight.rootStyle]);

	return (
		<div
			className={`${fillHeight ? "h-full overflow-auto" : "overflow-x-auto"} rounded-md border border-(--mantine-color-default-border) p-4 text-sm`}
			data-language={language}
			data-streamdown="code-block-body"
			style={{ backgroundColor: highlight?.bg?.split(";")[0] }}
		>
			{filename && (
				// Outside the code, so it takes the width shown rather than the
				// code's, and is truncated short of the buttons; held to the left
				// edge as the code scrolls sideways.
				<Text
					c="muted"
					size="xs"
					pl={10}
					pr={75}
					pt={5}
					pb={10}
					truncate="end"
					pos="sticky"
					left={0}
				>
					{filename}
				</Text>
			)}
			{/* As wide as its longest line, so each line — and the number held
			    to the left of it — spans everything scrolled through sideways. */}
			<pre className="w-max min-w-full bg-(--sdm-bg)" style={preStyle}>
				<code
					className={
						lineNumbers
							? "[counter-increment:line_0] [counter-reset:line]"
							: undefined
					}
					style={
						lineNumbers && startLine && startLine > 1
							? { counterReset: `line ${startLine - 1}` }
							: undefined
					}
				>
					{children}
				</code>
			</pre>
		</div>
	);
}
