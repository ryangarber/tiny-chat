/** biome-ignore-all lint/suspicious/noArrayIndexKey: lines stay in order */

import chalk, { type ChalkInstance } from "chalk";
import { Box, Text } from "ink";
import { useCode } from "#client/core/hooks/useCode.ts";
import type { CodeResult } from "#core/core/utils/CodeUtils.ts";
import { TextLayoutUtils } from "#tui/core/utils/TextLayoutUtils.ts";

export default function CodeLines({
	code,
	language,
	lineNumbers = true,
	startLine = 1,
	chalk: prechalk = chalk,
}: {
	code: string | CodeResult;
	language?: string | null;
	lineNumbers?: boolean;
	startLine?: number;
	chalk?: ChalkInstance;
}) {
	const { highlighted } = useCode({ code, language });

	const lineNumberLength = String(
		startLine + highlighted.tokens.length - 1,
	).length;

	const color = (
		color?: CodeResult["tokens"][number][number] | string | undefined,
	) => {
		if (typeof color === "object")
			color = (color.htmlStyle as { color?: string } | undefined)?.color;
		return color ? prechalk.hex(color.split(";")[0]) : prechalk;
	};

	return highlighted.tokens.map((line, lineIndex) => {
		const node = line.map((token) => color(token)(token.content));

		if (lineNumbers) {
			// Beside the line rather than in it, so it is never found as part of it.
			return (
				<Box key={lineIndex}>
					<Box flexShrink={0} ref={TextLayoutUtils.ignore}>
						<Text>
							{chalk.gray(
								`${(lineIndex + startLine)
									.toString()
									.padStart(lineNumberLength, " ")}. `,
							)}
						</Text>
					</Box>
					<Text>{node}</Text>
				</Box>
			);
		}

		return node;
	});
}
