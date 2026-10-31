import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import type {
	Categories,
	CategoryId,
	Usage,
} from "#client/features/editor/hooks/useEstimatedTokens.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import Box from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import type { Color } from "#tui/core/hooks/useColor.ts";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";

/**
 * Each category's color, shared by its run of the bar and its dot — the same
 * shades the app draws them in.
 */
const CATEGORY_COLORS: Record<CategoryId, Color> = {
	instructions: "#228be6",
	memories: "#be4bdb",
	thoughts: "#7950f2",
	tools: "#fd7e14",
	text: "#12b886",
	files: "#e64980",
};

/** The bar's width in cells, inside the popup's border and padding. */
const BAR_WIDTH = 24;

/** A pie filling by quarters, as the app's ring does by degrees. */
const PIES = ["○", "◔", "◑", "◕", "●"] as const;

const pie = (percent: number) =>
	percent <= 0
		? PIES[0]
		: PIES[Math.min(PIES.length - 1, Math.max(1, Math.round(percent / 25)))];

/**
 * The cells each category takes of the bar: its share, rounded, but at least
 * one for any it has tokens in, so a small one still shows its color. Where
 * that runs over, the largest give way.
 */
const runs = (categories: Categories, width: number) => {
	const cells = categories.map((category) =>
		category.tokens > 0 ? Math.max(1, Math.round(category.share * width)) : 0,
	);
	let over = cells.reduce((sum, count) => sum + count, 0) - width;
	while (over > 0) {
		const largest = cells.indexOf(Math.max(...cells));
		if (cells[largest] <= 1) break;
		cells[largest]--;
		over--;
	}
	return categories.map((category, index) => ({
		id: category.id,
		cells: cells[index],
	}));
};

/** The breakdown the pie opens: the bar, then each category by its dot. */
export function TokenBreakdown({
	usage,
	categories,
}: {
	usage: Usage<Color>;
	categories: Categories;
}) {
	const bar = runs(categories, BAR_WIDTH);
	const filled = bar.reduce((sum, run) => sum + run.cells, 0);

	return (
		<Box
			flexDirection="column"
			backgroundColor="interior"
			borderStyle="round"
			border
			paddingX={1}
			width={BAR_WIDTH + 4}
		>
			<Box justifyContent="space-between">
				<Text bold>context</Text>
				<Text color="textSubtle">
					{usage.loading ? (
						<Spinner type="dots" />
					) : (
						<>
							{CommonUtils.formatCount(usage.tokens)}
							{usage.maxTokens !== undefined && (
								<>
									{` / ${CommonUtils.formatCount(usage.maxTokens)} · `}
									<Text color={usage.color}>{Math.round(usage.percent)}%</Text>
								</>
							)}
						</>
					)}
				</Text>
			</Box>
			<Text>
				{bar.map(
					(run) =>
						run.cells > 0 && (
							<Text key={run.id} color={CATEGORY_COLORS[run.id]}>
								{"━".repeat(run.cells)}
							</Text>
						),
				)}
				<Text color="border">{"━".repeat(BAR_WIDTH - filled)}</Text>
			</Text>
			{categories.map((category) => (
				<Box key={category.id} justifyContent="space-between">
					<Text>
						<Text color={CATEGORY_COLORS[category.id]}>●</Text>{" "}
						{category.name.toLowerCase()}
					</Text>
					<Text color="textSubtle">
						{category.loading ? (
							<Spinner type="dots" />
						) : (
							CommonUtils.formatCount(category.tokens)
						)}
					</Text>
				</Box>
			))}
		</Box>
	);
}

/**
 * The pie, as the app's ring. It opens the breakdown while hovered, and a
 * click holds it open until the next — drawn by the editor, over the chat.
 */
export default function TokenUsage({
	usage,
	onOpenChange,
}: {
	usage: Usage<Color>;
	onOpenChange: (open: boolean) => void;
}) {
	const [pinned, setPinned] = useState(false);
	const [hovered, setHovered] = useState(false);
	const { mouseRef } = useMouseInput({
		onHoverStart: () => setHovered(true),
		onHoverEnd: () => setHovered(false),
		onClick: () => setPinned(!pinned),
	});

	const open = pinned || hovered;
	useEffect(() => onOpenChange(open), [open, onOpenChange]);

	return (
		<Box ref={(element) => mouseRef(element, 0)} flexShrink={0}>
			<Text color={usage.color} dimColor={hovered && !pinned}>
				{usage.loading ? <Spinner type="dots" /> : pie(usage.percent)}
			</Text>
		</Box>
	);
}
