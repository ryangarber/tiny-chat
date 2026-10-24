import { diffLines, diffWords } from "diff";
import type { CodeResult } from "#core/core/utils/CodeUtils.ts";
import { ColorUtils } from "#core/core/utils/ColorUtils.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

type Diff =
	| { type: "unchanged"; line: string }
	| { type: "removed"; line: string }
	| { type: "added"; line: string }
	| {
			type: "changed";
			lineBefore: string;
			lineAfter: string;
			parts: (
				| { type: "unchanged"; part: string }
				| { type: "removed"; part: string }
				| { type: "added"; part: string }
				| { type: "changed"; partBefore: string; partAfter: string }
			)[];
	  };

export type DiffContext =
	| Exclude<Diff, { type: "unchanged" }>
	| { type: "unchanged"; lines: string[] }
	| { type: "context"; line: string };

export const DiffUtils = {
	/**
	 * Create a diff between two strings.
	 */
	diff: ({ before, after }: { before: string; after: string }) => {
		const lineDiff = diffLines(before, after, {
			ignoreWhitespace: true,
			stripTrailingCr: true,
		});

		const result: Diff[] = [];

		for (let i = 0; i < lineDiff.length; i++) {
			const lineChange = lineDiff[i];

			if (lineChange.removed) {
				const nextLineChange = lineDiff[i + 1];

				if (nextLineChange?.added) {
					const removedLines = DiffUtils.split(lineChange.value);
					const addedLines = DiffUtils.split(nextLineChange.value);
					const pairs = Math.min(removedLines.length, addedLines.length);

					for (let j = 0; j < pairs; j++) {
						const removedLine = removedLines[j];
						const addedLine = addedLines[j];

						if (CommonUtils.getDistance(removedLine, addedLine) < 0.5) {
							const partDiff = diffWords(removedLine, addedLine);

							// nasty leftward shift so that changes are grouped together
							for (let l = partDiff.length - 1; l > 0; l--) {
								if (partDiff[l].value === partDiff[l - 1].value) {
									if (
										(partDiff[l].added || partDiff[l].removed) &&
										!partDiff[l - 1].added &&
										!partDiff[l - 1].removed
									) {
										partDiff[l - 1].added = partDiff[l].added;
										partDiff[l - 1].removed = partDiff[l].removed;
										partDiff[l].added = false;
										partDiff[l].removed = false;
									}
								} else {
									if (
										(partDiff[l].added && partDiff[l - 1].added) ||
										(partDiff[l].removed && partDiff[l - 1].removed)
									) {
										partDiff[l - 1].value += partDiff[l].value;
										partDiff.splice(l, 1);
									}
								}
							}

							const parts: Extract<Diff, { type: "changed" }>["parts"] = [];

							for (let k = 0; k < partDiff.length; k++) {
								const wordChange = partDiff[k];

								if (wordChange.removed) {
									const nextWordChange = partDiff[k + 1];

									if (nextWordChange?.added) {
										parts.push({
											type: "changed",
											partBefore: wordChange.value,
											partAfter: nextWordChange.value,
										});

										k++; // consumed nextWordChange
										continue;
									}

									parts.push({ type: "removed", part: wordChange.value });
									continue;
								}

								if (wordChange.added) {
									parts.push({ type: "added", part: wordChange.value });
									continue;
								}

								parts.push({ type: "unchanged", part: wordChange.value });
							}

							result.push({
								type: "changed",
								lineBefore: removedLine,
								lineAfter: addedLine,
								parts,
							});
						} else {
							result.push({ type: "removed", line: removedLine });
							result.push({ type: "added", line: addedLine });
						}
					}

					for (let j = pairs; j < removedLines.length; j++) {
						result.push({ type: "removed", line: removedLines[j] });
					}

					for (let j = pairs; j < addedLines.length; j++) {
						result.push({ type: "added", line: addedLines[j] });
					}

					i++; // consumed nextLineChange
					continue;
				}

				for (const line of DiffUtils.split(lineChange.value)) {
					result.push({ type: "removed", line });
				}
				continue;
			}

			if (lineChange.added) {
				for (const line of DiffUtils.split(lineChange.value)) {
					result.push({ type: "added", line });
				}
				continue;
			}

			for (const line of DiffUtils.split(lineChange.value)) {
				result.push({
					type: "unchanged",
					line,
				});
			}
		}

		return result;
	},

	/**
	 * Collapses consecutive unchanged lines and includes context around changes.
	 */
	context: (
		diff: Diff[],
		{ contextLines = 3 }: { contextLines?: number } = {},
	): DiffContext[] => {
		// collapse unchanged
		const collapsed: Exclude<DiffContext, { type: "context" }>[] = [];

		for (const change of diff) {
			if (change.type === "unchanged") {
				const last = collapsed[collapsed.length - 1];
				if (last?.type === "unchanged") {
					last.lines.push(change.line);
				} else {
					collapsed.push({ type: "unchanged", lines: [change.line] });
				}
			} else {
				collapsed.push(change);
			}
		}

		// move unchanged to context
		const result: DiffContext[] = [];
		const push = (type: "context" | "unchanged", lines: string[]) => {
			if (lines.length > 0) {
				if (type === "context") {
					for (const line of lines) {
						result.push({ type, line });
					}
				} else if (type === "unchanged") {
					result.push({ type, lines });
				}
			}
		};

		for (let i = 0; i < collapsed.length; i++) {
			const item = collapsed[i];

			if (item.type !== "unchanged") {
				result.push(item);
				continue;
			}

			const hasBefore = i > 0;
			const hasAfter = i < collapsed.length - 1;
			const { lines } = item;

			if (!hasBefore && !hasAfter) {
				push("unchanged", lines);
			} else if (hasBefore && hasAfter) {
				if (lines.length <= contextLines * 2) {
					push("context", lines);
				} else {
					push("context", lines.slice(0, contextLines));
					push(
						"unchanged",
						lines.slice(contextLines, lines.length - contextLines),
					);
					push("context", lines.slice(lines.length - contextLines));
				}
			} else if (hasBefore) {
				push("context", lines.slice(0, contextLines));
				push("unchanged", lines.slice(contextLines));
			} else {
				const splitAt = Math.max(0, lines.length - contextLines);
				push("unchanged", lines.slice(0, splitAt));
				push("context", lines.slice(splitAt));
			}
		}

		return result;
	},

	/**
	 * The lines of a diff in order as text, folded runs of unchanged lines
	 * included and both sides of a changed line, for searching it.
	 */
	lines: (diff: DiffContext[]): string[] =>
		diff.flatMap((change) => {
			if (change.type === "unchanged") return change.lines;
			if (change.type === "changed")
				return [change.lineBefore, change.lineAfter];
			return [change.line];
		}),

	split: (value: string): string[] => {
		const lines = value.split("\n");
		if (lines.length && lines[lines.length - 1] === "") {
			lines.pop();
		}
		return lines;
	},

	colorBright: (type: DiffContext["type"]): string | undefined => {
		switch (type) {
			case "added":
				return "#6ae66a";
			case "removed":
				return "#ff6b6b";
			default:
				return undefined;
		}
	},

	color: (type: DiffContext["type"], code?: CodeResult): string | undefined => {
		if (code) {
			const layer = DiffUtils.color(type);
			if (!layer) return undefined;
			return ColorUtils.blend(code.bg ?? "transparent", layer);
		}
		switch (type) {
			case "added":
				return "rgba(0, 255, 0, 0.1)";
			case "removed":
				return "rgba(255, 0, 0, 0.1)";
			default:
				return undefined;
		}
	},
} as const;
