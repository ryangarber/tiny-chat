/** biome-ignore-all lint/suspicious/noArrayIndexKey: code stays in order */

import { Box, Button, Group } from "@mantine/core";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCode } from "#client/core/hooks/useCode.ts";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";
import { CodeUtils } from "#core/core/utils/CodeUtils.ts";
import { DiffUtils } from "#core/features/file/utils/DiffUtils.ts";
import CodeLines from "#gui/features/code/components/CodeLines.tsx";

export default function DiffLines({
	diff,
	expanded,
	setExpanded,
	language,
}: {
	diff: ReturnType<typeof DiffUtils.context>;
	expanded: number[];
	setExpanded: Dispatch<SetStateAction<number[]>>;
	language: string;
}) {
	// Unfolded whole while find shows a match somewhere in it.
	const revealed = useFindRevealed();
	const isExpanded = (index: number) => revealed || expanded.includes(index);
	useFindHidden(
		diff.some(
			(change, index) => change.type === "unchanged" && !isExpanded(index),
		),
	);

	return (
		<Box miw="100%" w="max-content">
			{diff.flatMap((change, index) => (
				<div key={index}>
					{change.type === "unchanged" &&
						isExpanded(index) &&
						change.lines.map((line, lineIndex) => (
							<Block key={lineIndex} type={change.type} expanded>
								<div style={{ flex: 1 }}>
									<CodeLines
										code={line}
										language={language}
										lineNumbers={false}
									/>
								</div>
							</Block>
						))}
					{(change.type !== "unchanged" || !isExpanded(index)) && (
						<Block key={index} type={change.type}>
							{change.type === "unchanged" && (
								<Button
									variant="transparent"
									bg="rgba(0, 0, 0, 0.1)"
									flex={1}
									size="xs"
									onClick={() =>
										setExpanded((previous) => [...previous, index])
									}
								>
									{change.lines.length} unchanged line
									{change.lines.length === 1 ? "" : "s"}
								</Button>
							)}
							{change.type !== "unchanged" && (
								<div style={{ flex: 1 }}>
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
								</div>
							)}
						</Block>
					)}
				</div>
			))}
		</Box>
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
	language: string;
}) {
	const { highlighted: beforeHL } = useCode({
		code: change.lineBefore,
		language,
	});
	const { highlighted: afterHL } = useCode({
		code: change.lineAfter,
		language,
	});

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
					<span style={{ backgroundColor: DiffUtils.color("changed") }}>
						<span
							style={{
								backgroundColor: DiffUtils.color("removed"),
								padding: "2px 4px",
							}}
						>
							<CodeLines
								code={CodeUtils.extractTokenRange(
									beforeHL,
									bStart,
									nextBeforeOffset,
								)}
								lineNumbers={false}
							/>
						</span>
						<span
							style={{
								backgroundColor: DiffUtils.color("added"),
								padding: "2px 4px",
							}}
						>
							<CodeLines
								code={CodeUtils.extractTokenRange(
									afterHL,
									aStart,
									nextAfterOffset,
								)}
								lineNumbers={false}
							/>
						</span>
					</span>
				);
			} else if (part.type === "removed") {
				const bStart = beforeOffset;
				nextBeforeOffset += part.part.length;
				node = (
					<span
						style={{
							backgroundColor: DiffUtils.color("removed"),
							padding: "2px 0",
						}}
					>
						<CodeLines
							code={CodeUtils.extractTokenRange(
								beforeHL,
								bStart,
								nextBeforeOffset,
							)}
							lineNumbers={false}
						/>
					</span>
				);
			} else if (part.type === "added") {
				const aStart = afterOffset;
				nextAfterOffset += part.part.length;
				node = (
					<span
						style={{
							backgroundColor: DiffUtils.color("added"),
							padding: "2px 0",
						}}
					>
						<CodeLines
							code={CodeUtils.extractTokenRange(
								afterHL,
								aStart,
								nextAfterOffset,
							)}
							lineNumbers={false}
						/>
					</span>
				);
			} else {
				// unchanged — use before tokens (both sides are identical)
				const bStart = beforeOffset;
				nextBeforeOffset += part.part.length;
				nextAfterOffset += part.part.length;
				node = (
					<span style={{ padding: "2px 0" }}>
						<CodeLines
							code={CodeUtils.extractTokenRange(
								beforeHL,
								bStart,
								nextBeforeOffset,
							)}
							lineNumbers={false}
						/>
					</span>
				);
			}

			return {
				nodes: [...accumulator.nodes, <span key={partIndex}>{node}</span>],
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
	expanded,
}: {
	children: ReactNode;
	type: ReturnType<typeof DiffUtils.context>[number]["type"];
	expanded?: boolean;
}) {
	return (
		<Group
			gap={0}
			align="flex-start"
			wrap="nowrap"
			miw="100%"
			bg={DiffUtils.color(type)}
			p={2}
		>
			{(type !== "unchanged" || expanded) && (
				<Box
					w={20}
					miw={20}
					h={20}
					fz="sm"
					c="dimmed"
					style={{ textAlign: "center" }}
				>
					{type === "removed" && "-"}
					{type === "added" && "+"}
					{type === "changed" && "~"}
				</Box>
			)}
			{children}
		</Group>
	);
}
