/** biome-ignore-all lint/suspicious/noArrayIndexKey: lines stay in order */

import { Pressable } from "better-ink-ui";
import chalk from "chalk";
import { Text } from "ink";
import { type ReactNode, useState } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";
import { type CodeResult, CodeUtils } from "#core/core/utils/CodeUtils.ts";
import {
	type DiffContext,
	DiffUtils,
} from "#core/features/file/utils/DiffUtils.ts";
import CodeLines from "#tui/features/code/components/CodeLines.tsx";

export default function DiffLines({
	diff,
	highlighted,
	language = null,
}: {
	diff: ReturnType<typeof DiffUtils.context>;
	highlighted: CodeResult;
	language: string | null | undefined;
}) {
	const [expanded, setExpanded] = useState<number[]>([]);
	// Unfolded whole while find shows a match somewhere in it.
	const revealed = useFindRevealed();
	const isExpanded = (index: number) => revealed || expanded.includes(index);
	useFindHidden(
		diff.some(
			(change, index) => change.type === "unchanged" && !isExpanded(index),
		),
	);

	return diff.map((change, index) =>
		change.type === "unchanged" ? (
			isExpanded(index) ? (
				change.lines.map((line, lineIndex) => (
					<Block
						key={`${index}:${lineIndex}`}
						type="context"
						highlighted={highlighted}
					>
						<CodeLines code={line} language={language} lineNumbers={false} />
					</Block>
				))
			) : (
				<Pressable
					key={index}
					onPress={() => setExpanded((previous) => [...previous, index])}
				>
					{({ isHovered }) => (
						<Block type={change.type} highlighted={highlighted}>
							<Text dimColor={isHovered}>
								{` ⋮ ${change.lines.length} unchanged line${change.lines.length === 1 ? "" : "s"}`}
							</Text>
						</Block>
					)}
				</Pressable>
			)
		) : (
			<Block key={index} type={change.type} highlighted={highlighted}>
				{change.type === "changed" && (
					<ChangedLines change={change} language={language} />
				)}
				{change.type !== "changed" && (
					<CodeLines
						code={change.line}
						language={language}
						lineNumbers={false}
					/>
				)}
			</Block>
		),
	);
}

function ChangedLines({
	change,
	language,
}: {
	change: Extract<
		ReturnType<typeof DiffUtils.context>[number],
		{ type: "changed" }
	>;
	language: string | null;
}) {
	const { highlighted: beforeHL } = useCode({
		code: change.lineBefore,
		language,
	});
	const { highlighted: afterHL } = useCode({
		code: change.lineAfter,
		language,
	});

	const bgColor = (type: DiffContext["type"], highlighted: CodeResult) => {
		const color = DiffUtils.color(type, highlighted);
		const hex = color?.split(";")[0];
		return hex ? chalk.bgHex(hex) : chalk;
	};

	return change.parts.reduce<{
		nodes: ReactNode[];
		beforeOffset: number;
		afterOffset: number;
	}>(
		(accumulator, part, partIndex) => {
			const { beforeOffset, afterOffset } = accumulator;
			let nextBeforeOffset = beforeOffset;
			let nextAfterOffset = afterOffset;
			let node: ReactNode;

			if (part.type === "changed") {
				const bStart = beforeOffset;
				const aStart = afterOffset;
				nextBeforeOffset += part.partBefore.length;
				nextAfterOffset += part.partAfter.length;
				node = (
					<Text backgroundColor={DiffUtils.color("changed", beforeHL)}>
						<CodeLines
							code={CodeUtils.extractTokenRange(
								beforeHL,
								bStart,
								nextBeforeOffset,
							)}
							language={language}
							lineNumbers={false}
							chalk={bgColor("removed", beforeHL)}
						/>
						<CodeLines
							code={CodeUtils.extractTokenRange(
								afterHL,
								aStart,
								nextAfterOffset,
							)}
							language={language}
							lineNumbers={false}
							chalk={bgColor("added", afterHL)}
						/>
					</Text>
				);
			} else if (part.type === "removed") {
				const bStart = beforeOffset;
				nextBeforeOffset += part.part.length;
				const tokens = CodeUtils.extractTokenRange(
					beforeHL,
					bStart,
					nextBeforeOffset,
				);
				node = (
					<CodeLines
						code={tokens}
						language={language}
						lineNumbers={false}
						chalk={bgColor("removed", beforeHL)}
					/>
				);
			} else if (part.type === "added") {
				const aStart = afterOffset;
				nextAfterOffset += part.part.length;
				const tokens = CodeUtils.extractTokenRange(
					afterHL,
					aStart,
					nextAfterOffset,
				);
				node = (
					<CodeLines
						code={tokens}
						language={language}
						lineNumbers={false}
						chalk={bgColor("added", afterHL)}
					/>
				);
			} else {
				const bStart = beforeOffset;
				nextBeforeOffset += part.part.length;
				nextAfterOffset += part.part.length;
				node = (
					<CodeLines
						code={CodeUtils.extractTokenRange(
							beforeHL,
							bStart,
							nextBeforeOffset,
						)}
						language={language}
						lineNumbers={false}
					/>
				);
			}

			return {
				nodes: [...accumulator.nodes, <Text key={partIndex}>{node}</Text>],
				beforeOffset: nextBeforeOffset,
				afterOffset: nextAfterOffset,
			};
		},
		{ nodes: [], beforeOffset: 0, afterOffset: 0 },
	).nodes;
}

function Block({
	children,
	type,
	highlighted,
}: {
	children: ReactNode;
	type: DiffContext["type"];
	highlighted: CodeResult;
}) {
	const backgroundColor = DiffUtils.color(type, highlighted);
	return (
		<Text backgroundColor={backgroundColor}>
			{type === "removed" && "-"}
			{type === "added" && "+"}
			{type === "changed" && "~"}
			{type === "unchanged" || (type === "context" && " ")}
			{` `}
			{children}
		</Text>
	);
}
