/** biome-ignore-all lint/suspicious/noArrayIndexKey: code stays in order */

import { useCode } from "#client/core/hooks/useCode.ts";
import type { CodeResult } from "#core/core/utils/CodeUtils.ts";

export default function CodeLines({
	code,
	language,
	lineNumbers,
}: {
	code: string | CodeResult;
	language?: string | null;
	lineNumbers: boolean;
}) {
	const { highlighted } = useCode({ code, language });

	// Numbered lines are blocks. Unnumbered ones stay inline, so a diff can
	// set a fragment of a line inside its own markup, and are separated by
	// their line breaks instead.
	return highlighted.tokens.map((line, lineIndex) => (
		<span
			className={
				lineNumbers
					? // Held to the left edge as the line scrolls sideways under it,
						// painted in the block's color — the gap after it too — so the
						// line is hidden there rather than showing through. It sticks at
						// the block's padding, so a shadow in the same color covers that.
						"block before:content-[counter(line)] before:inline-block before:[counter-increment:line] before:sticky before:left-0 before:z-1 before:box-content before:w-6 before:pr-4 before:bg-(--sdm-bg) before:[box-shadow:-16px_0_0_var(--sdm-bg)] before:text-[13px] before:text-right before:text-muted-foreground/50 before:font-mono before:select-none"
					: undefined
			}
			key={lineIndex}
		>
			{!lineNumbers && lineIndex > 0 && "\n"}
			{line.length === 0 || (line.length === 1 && line[0].content === "")
				? lineNumbers
					? "\n"
					: ""
				: line.map((token, tokenIndex) => {
						const tokenStyle: Record<string, string> = {};
						let hasBg = Boolean(token.bgColor);

						if (token.color) {
							tokenStyle["--sdm-c"] = token.color;
						}
						if (token.bgColor) {
							tokenStyle["--sdm-tbg"] = token.bgColor;
						}

						if (token.htmlStyle) {
							for (const [key, value] of Object.entries(token.htmlStyle)) {
								if (key === "color") {
									tokenStyle["--sdm-c"] = value;
								} else if (key === "background-color") {
									tokenStyle["--sdm-tbg"] = value;
									hasBg = true;
								} else {
									// Shiki's are CSS names (`font-style`); React wants `fontStyle`
									tokenStyle[
										key.replace(/-([a-z])/g, (_, char: string) =>
											char.toUpperCase(),
										)
									] = value;
								}
							}
						}

						return (
							<span
								className={`text-(--sdm-c,inherit) ${hasBg ? "bg-(--sdm-tbg)" : ""}`}
								key={tokenIndex}
								style={tokenStyle}
								{...token.htmlAttrs}
							>
								{token.content}
							</span>
						);
					})}
		</span>
	));
}
