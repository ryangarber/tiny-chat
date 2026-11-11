import { diffArrays } from "diff";
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

/** Tokens of a line within a run of the word diff, before → after. */
type Run =
	| { type: "unchanged"; tokens: string[] }
	| { type: "change"; removed: string[]; added: string[] };

/** Words, runs of whitespace, and each other character on its own. */
const TOKEN = /[\p{L}\p{M}\p{N}_]+|\s+|./gsu;

/** Above this many removed × added lines in a hunk, pair them by index. */
const MAX_ALIGN = 1024;

/** Lines further apart than this are shown as removed and added. */
const MAX_DISTANCE = 0.5;

const length = (tokens: string[]) =>
	tokens.reduce((total, token) => total + token.length, 0);

const isBlank = (token: string | undefined) =>
	token !== undefined && token.trim() === "";

/**
 * Whether the tokens close every bracket they open, and sit outside any
 * quotes the line opens before them, closing any they open themselves.
 */
const isBalanced = (tokens: string[], preceding: string[]) => {
	const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
	const stack: string[] = [];
	for (const token of tokens) {
		if (token === "(" || token === "[" || token === "{") stack.push(token);
		else if (pairs[token] && stack.pop() !== pairs[token]) return false;
	}
	const isEven = (list: string[], quote: string) =>
		list.filter((token) => token === quote).length % 2 === 0;
	return (
		stack.length === 0 &&
		['"', "'", "`"].every(
			(quote) => isEven(preceding, quote) && isEven(tokens, quote),
		)
	);
};

/** Runs in order, adjacent runs of one type merged and empty runs dropped. */
const normalize = (runs: Run[]): Run[] => {
	const result: Run[] = [];
	for (const run of runs) {
		const isEmpty =
			run.type === "unchanged"
				? run.tokens.length === 0
				: run.removed.length === 0 && run.added.length === 0;
		if (isEmpty) continue;
		const last = result[result.length - 1];
		if (last?.type === "unchanged" && run.type === "unchanged") {
			last.tokens.push(...run.tokens);
		} else if (last?.type === "change" && run.type === "change") {
			last.removed.push(...run.removed);
			last.added.push(...run.added);
		} else {
			result.push(
				run.type === "unchanged"
					? { type: "unchanged", tokens: [...run.tokens] }
					: {
							type: "change",
							removed: [...run.removed],
							added: [...run.added],
						},
			);
		}
	}
	return result;
};

/**
 * Slides each pure insertion or deletion along the identical tokens around
 * it: up against a neighboring change so the two read as one, and otherwise to
 * where it covers whole brackets and words rather than straddling them.
 */
const slide = (input: Run[]): Run[] => {
	let runs = input;
	for (let i = 0; i < runs.length; i++) {
		const run = runs[i];
		if (run.type !== "change") continue;
		if (run.removed.length > 0 && run.added.length > 0) continue;

		const moved = run.removed.length > 0 ? run.removed : run.added;
		const previous =
			runs[i - 1]?.type === "unchanged" ? runs[i - 1] : undefined;
		const next = runs[i + 1]?.type === "unchanged" ? runs[i + 1] : undefined;
		const before = previous?.type === "unchanged" ? previous.tokens : [];
		const after = next?.type === "unchanged" ? next.tokens : [];
		if (before.length === 0 && after.length === 0) continue;

		// The side holding the change, and where the change can sit in it while
		// the identical tokens around it stay the same.
		const tokens = [...before, ...moved, ...after];
		const size = moved.length;
		let start = before.length;
		while (start > 0 && tokens[start - 1] === tokens[start - 1 + size]) start--;
		let end = before.length;
		while (
			end < before.length + after.length &&
			tokens[end] === tokens[end + size]
		)
			end++;

		// The same side of the line before the tokens it can slide along.
		const preceding = runs
			.slice(0, previous ? i - 1 : i)
			.flatMap((other) =>
				other.type === "unchanged"
					? other.tokens
					: run.removed.length > 0
						? other.removed
						: other.added,
			);
		const score = (at: number) => {
			const part = tokens.slice(at, at + size);
			return (
				(isBalanced(part, [...preceding, ...tokens.slice(0, at)]) ? 2 : 0) +
				(isBlank(part[0]) ? 0 : 1) +
				(isBlank(part[size - 1]) ? 0 : 1)
			);
		};

		// Where it covers the most whole brackets and words, the later on a
		// tie, as additions to a list follow what they're added after.
		let position = start;
		for (let at = start + 1; at <= end; at++) {
			if (score(at) >= score(position)) position = at;
		}
		// Next to a neighboring change unless that splits what the best covers.
		const hasLeft = i >= 2 && runs[i - 2].type === "change";
		const hasRight = i + 2 < runs.length && runs[i + 2].type === "change";
		const last = before.length + after.length;
		if (hasRight && end === last && score(end) >= score(position)) {
			position = end;
		} else if (hasLeft && start === 0 && score(0) >= score(position)) {
			position = 0;
		}
		if (position === before.length) continue;

		const part = tokens.slice(position, position + size);
		runs = normalize([
			...runs.slice(0, previous ? i - 1 : i),
			{ type: "unchanged", tokens: tokens.slice(0, position) },
			run.removed.length > 0
				? { type: "change", removed: part, added: [] }
				: { type: "change", removed: [], added: part },
			{ type: "unchanged", tokens: tokens.slice(position + size) },
			...runs.slice(next ? i + 2 : i + 1),
		]);
		// Start over: a change merged into its neighbor may slide on, and
		// one already in place stays there.
		i = -1;
	}
	return runs;
};

/**
 * Folds an identical stretch between two changes into them when it is
 * shorter than both, so one edit reads as one change instead of confetti.
 */
const absorb = (input: Run[]): Run[] => {
	let runs = input;
	for (let i = 1; i < runs.length - 1; i++) {
		const [left, middle, right] = [runs[i - 1], runs[i], runs[i + 1]];
		if (
			middle.type !== "unchanged" ||
			left.type !== "change" ||
			right.type !== "change"
		)
			continue;
		const size = length(middle.tokens);
		const leftSize = Math.max(length(left.removed), length(left.added));
		const rightSize = Math.max(length(right.removed), length(right.added));
		if (size >= leftSize || size >= rightSize) continue;
		runs = [
			...runs.slice(0, i - 1),
			{
				type: "change",
				removed: [...left.removed, ...middle.tokens, ...right.removed],
				added: [...left.added, ...middle.tokens, ...right.added],
			},
			...runs.slice(i + 2),
		];
		i = 0;
	}
	return runs;
};

const isSimilar = (lineBefore: string, lineAfter: string) =>
	CommonUtils.getDistance(lineBefore.trim(), lineAfter.trim()) < MAX_DISTANCE;

/**
 * Pairs of removed and added lines to show as changed, in order on both
 * sides, the most similar overall when the hunk is small enough to compare.
 */
const align = (removed: string[], added: string[]): [number, number][] => {
	if (removed.length * added.length > MAX_ALIGN) {
		const pairs: [number, number][] = [];
		for (let i = 0; i < Math.min(removed.length, added.length); i++) {
			if (isSimilar(removed[i], added[i])) pairs.push([i, i]);
		}
		return pairs;
	}

	const similarity = removed.map((lineBefore) =>
		added.map((lineAfter) => {
			const distance = CommonUtils.getDistance(
				lineBefore.trim(),
				lineAfter.trim(),
			);
			return distance < MAX_DISTANCE ? 1 - distance : 0;
		}),
	);
	const best = Array.from({ length: removed.length + 1 }, () =>
		new Array<number>(added.length + 1).fill(0),
	);
	for (let i = removed.length - 1; i >= 0; i--) {
		for (let j = added.length - 1; j >= 0; j--) {
			best[i][j] = Math.max(
				best[i + 1][j],
				best[i][j + 1],
				similarity[i][j] > 0 ? similarity[i][j] + best[i + 1][j + 1] : 0,
			);
		}
	}
	const pairs: [number, number][] = [];
	let [i, j] = [0, 0];
	while (i < removed.length && j < added.length) {
		if (
			similarity[i][j] > 0 &&
			best[i][j] === similarity[i][j] + best[i + 1][j + 1]
		) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (best[i][j] === best[i + 1][j]) i++;
		else j++;
	}
	return pairs;
};

export const DiffUtils = {
	/**
	 * Create a diff between two strings.
	 */
	diff: ({ before, after }: { before: string; after: string }) => {
		const linesBefore = DiffUtils.split(before.replace(/\r\n/g, "\n"));
		const linesAfter = DiffUtils.split(after.replace(/\r\n/g, "\n"));

		// Lines that differ only in whitespace still line up, and show as changed.
		const lineDiff = diffArrays(linesBefore, linesAfter, {
			comparator: (a, b) => a.trim() === b.trim(),
		});

		const result: Diff[] = [];
		let [indexBefore, indexAfter] = [0, 0];

		for (let i = 0; i < lineDiff.length; i++) {
			const lineChange = lineDiff[i];

			if (!lineChange.added && !lineChange.removed) {
				for (let j = 0; j < lineChange.count; j++) {
					result.push(
						DiffUtils.line(
							linesBefore[indexBefore++],
							linesAfter[indexAfter++],
						),
					);
				}
				continue;
			}

			// a hunk: the removed and added lines between two unchanged ones
			const removed: string[] = [];
			const added: string[] = [];
			for (; i < lineDiff.length; i++) {
				const { added: isAdded, removed: isRemoved, count } = lineDiff[i];
				if (isRemoved) {
					removed.push(...linesBefore.slice(indexBefore, indexBefore + count));
					indexBefore += count;
				} else if (isAdded) {
					added.push(...linesAfter.slice(indexAfter, indexAfter + count));
					indexAfter += count;
				} else break;
			}
			i--;

			let [r, a] = [0, 0];
			for (const [pairBefore, pairAfter] of [
				...align(removed, added),
				[removed.length, added.length],
			]) {
				for (; r < pairBefore; r++) {
					result.push({ type: "removed", line: removed[r] });
				}
				for (; a < pairAfter; a++) {
					result.push({ type: "added", line: added[a] });
				}
				if (r < removed.length && a < added.length) {
					result.push(DiffUtils.line(removed[r++], added[a++]));
				}
			}
		}

		return result;
	},

	/**
	 * One line on both sides: unchanged, or changed with the parts that
	 * differ, grouped so that each edit reads as one.
	 */
	line: (lineBefore: string, lineAfter: string): Diff => {
		if (lineBefore === lineAfter)
			return { type: "unchanged", line: lineBefore };

		const tokenDiff = diffArrays(
			lineBefore.match(TOKEN) ?? [],
			lineAfter.match(TOKEN) ?? [],
		);
		const runs = absorb(
			slide(
				normalize(
					tokenDiff.map((change): Run => {
						if (change.removed)
							return { type: "change", removed: change.value, added: [] };
						if (change.added)
							return { type: "change", removed: [], added: change.value };
						return { type: "unchanged", tokens: change.value };
					}),
				),
			),
		);

		return {
			type: "changed",
			lineBefore,
			lineAfter,
			parts: runs.map((run) => {
				if (run.type === "unchanged")
					return { type: "unchanged", part: run.tokens.join("") };
				if (run.removed.length === 0)
					return { type: "added", part: run.added.join("") };
				if (run.added.length === 0)
					return { type: "removed", part: run.removed.join("") };
				return {
					type: "changed",
					partBefore: run.removed.join(""),
					partAfter: run.added.join(""),
				};
			}),
		};
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
