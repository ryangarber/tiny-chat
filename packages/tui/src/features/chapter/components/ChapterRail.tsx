import { type DOMElement, Box as InkBox } from "ink";
import { useRef, useState } from "react";
import type { Chapter } from "#client/features/chapter/types/chapter.ts";
import { ChapterUtils } from "#client/features/chapter/utils/ChapterUtils.ts";
import type { ScrollRail } from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import { useWidth } from "#tui/core/hooks/useWidth.ts";

/** Widest a hovered mark's label is drawn, in columns. */
const LABEL_WIDTH = 60;

/** Rows between marks, where the track has room for them: one left blank. */
const GAP = 2;

/** Rows below the top of the viewport a chapter counts as the one being read from. */
const READING_LINE = 2;

/** Which mark is drawn on a row more than one falls on: the one that matters most. */
const weight = (chapter: Chapter, current: boolean) =>
	chapter.type === "toolCall" ? 2 : current ? 1 : 0;

const captionOf = (chapter: Chapter) =>
	chapter.type === "message"
		? "You"
		: chapter.state === "feedback"
			? "Waiting on you"
			: "Running";

/**
 * The chat's chapters, listed in order in the column beside the transcript's
 * scrollbar: a line for every message of the user's, a dot for every call
 * still going. The one being read is highlighted, and pointing at a mark
 * shows what it is.
 *
 * Marks are spaced evenly rather than set where their messages sit, as the
 * app's are: messages out of view are only estimated until drawn, so
 * positions taken from the layout would shift every time scrolling draws one.
 * Shown whenever there is a chapter, scrolling or not.
 */
export default function ChapterRail({
	rail,
	chapters,
	onChapter,
}: {
	rail: ScrollRail;
	chapters: Chapter[];
	onChapter: (chapter: Chapter) => void;
}) {
	const columns = useWidth();

	// Over the rows between the first and the last, so both ends can be used.
	const positions = ChapterUtils.stack({
		count: chapters.length,
		track: Math.max(0, rail.viewport - 1),
		gap: GAP,
	}).map(Math.round);
	// The view lays out every child, drawn or not, so the one under the reading
	// line is where it is. A call counts from the message it is in. Resting at
	// the bottom, the last chapter in sight is the one read.
	const atBottom = rail.offset >= rail.content - rail.viewport;
	const current = ChapterUtils.getCurrent({
		tops: chapters.map((chapter) => rail.tops[chapter.index] ?? 0),
		at: rail.offset + (atBottom ? rail.viewport - 1 : READING_LINE),
	});

	// One mark to a row.
	const rows = new Map<number, { chapter: Chapter; current: boolean }>();
	chapters.forEach((chapter, index) => {
		const row = positions[index] ?? 0;
		const isCurrent = index === current;
		const held = rows.get(row);
		if (
			!held ||
			weight(chapter, isCurrent) > weight(held.chapter, held.current)
		)
			rows.set(row, { chapter, current: isCurrent });
	});
	const marks = [...rows].map(([row, mark]) => ({ row, ...mark }));

	const [hovered, setHovered] = useState<number | null>(null);
	const { mouseRef } = useMouseInput({
		onClick: ({ index, event }) => {
			if (event.button !== "left") return;
			const chapter = marks[index]?.chapter;
			if (chapter) onChapter(chapter);
		},
		onHoverStart: ({ index }) => setHovered(index),
		onHoverEnd: ({ index }) =>
			setHovered((held) => (held === index ? null : held)),
	});

	// Takes the mouse over the column, so pressing a mark never starts a
	// selection in the content beneath.
	const columnRef = useRef<DOMElement | null>(null);
	useMouseLayer(columnRef, chapters.length > 0);

	if (!chapters.length) return null;

	const shown = hovered !== null ? marks[hovered] : undefined;
	const width = Math.max(10, Math.min(LABEL_WIDTH, columns - 6));

	return (
		<>
			<InkBox
				ref={columnRef}
				position="absolute"
				top={0}
				right={1}
				width={1}
				height={rail.viewport}
			>
				{marks.map((mark, index) => (
					<InkBox
						key={mark.chapter.key}
						ref={(node) => mouseRef(node, index)}
						position="absolute"
						top={mark.row}
						left={0}
						width={1}
						height={1}
					>
						<Text
							color={
								mark.chapter.type === "toolCall"
									? mark.chapter.state === "feedback"
										? "yellow"
										: "#ff9d3c"
									: index === hovered || mark.current
										? "primary"
										: "textSubtle"
							}
						>
							{mark.chapter.type === "toolCall" ? "•" : "━"}
						</Text>
					</InkBox>
				))}
			</InkBox>
			{shown && (
				// Beside the mark, over the transcript, and out of the mouse's way.
				<InkBox
					position="absolute"
					top={Math.min(shown.row, Math.max(0, rail.viewport - 1))}
					right={3}
					width={width}
					justifyContent="flex-end"
				>
					<Text backgroundColor="interior" wrap="truncate-end">
						<Text color="textSubtle">{` ${captionOf(shown.chapter)} · `}</Text>
						<Text color="text">{`${shown.chapter.label} `}</Text>
					</Text>
				</InkBox>
			)}
		</>
	);
}
