import { Text, Tooltip } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { Chapter } from "#client/features/chapter/types/chapter.ts";
import { ChapterUtils } from "#client/features/chapter/utils/ChapterUtils.ts";
import classes from "#gui/features/chapter/styles/chapters.module.css";

/** Pixels between marks, where the track has room for them. */
const GAP = 12;

/**
 * Pixels below the covered top of the viewport a chapter counts as the one
 * being read from: a little past where one gone to comes to rest.
 */
const READING_LINE = 48;

/** Where a message's slot starts in the scrolled content. */
const topOf = (viewport: HTMLElement, id: string) => {
	const node = viewport.querySelector(
		`[data-message-slot="${CSS.escape(id)}"]`,
	);
	if (!node) return null;
	return (
		node.getBoundingClientRect().top -
		viewport.getBoundingClientRect().top +
		viewport.scrollTop
	);
};

const captionOf = (chapter: Chapter) =>
	chapter.type === "message"
		? "You"
		: chapter.state === "feedback"
			? "Waiting on you"
			: "Running";

/**
 * The chat's chapters, listed in order beside its scrollbar: a tick for every
 * message of the user's and a pulsing dot for every call still going. The one
 * being read is highlighted.
 *
 * Marks are spaced evenly rather than set where their messages sit: messages
 * out of view are only estimated until drawn, so positions taken from the
 * layout would shift every time scrolling draws one. Shown whenever there is
 * a chapter, scrolling or not.
 */
export default function ChapterRail({
	viewport,
	chapters,
	top = 0,
	bottom = 0,
	onChapter,
}: {
	viewport: HTMLElement | null;
	chapters: Chapter[];
	/** Pixels of the viewport covered at its top, which the rail keeps clear of. */
	top?: number;
	/** Pixels covered at its bottom, such as by the editor. */
	bottom?: number;
	onChapter: (chapter: Chapter) => void;
}) {
	const [track, setTrack] = useState(0);
	const [current, setCurrent] = useState(-1);

	useEffect(() => {
		if (!viewport) return;
		let frame: number | null = null;

		const measure = () => {
			frame = null;
			const content = viewport.scrollHeight;
			setTrack(Math.max(0, viewport.clientHeight - top - bottom));
			// Slots out of view are only estimated, but the one under the reading
			// line is where it is.
			const atBottom =
				viewport.scrollTop >= content - viewport.clientHeight - 1;
			setCurrent(
				ChapterUtils.getCurrent({
					tops: chapters.map(
						(chapter) => topOf(viewport, chapter.messageId) ?? 0,
					),
					// Resting at the bottom, the last chapter in sight is the one read.
					at:
						viewport.scrollTop +
						(atBottom ? viewport.clientHeight - bottom : top + READING_LINE),
				}),
			);
		};
		const schedule = () => {
			if (frame === null) frame = requestAnimationFrame(measure);
		};

		measure();
		viewport.addEventListener("scroll", schedule, { passive: true });
		const resize = new ResizeObserver(schedule);
		resize.observe(viewport);
		for (const child of viewport.children) resize.observe(child);
		return () => {
			if (frame !== null) cancelAnimationFrame(frame);
			viewport.removeEventListener("scroll", schedule);
			resize.disconnect();
		};
	}, [viewport, chapters, top, bottom]);

	const positions = useMemo(
		() => ChapterUtils.stack({ count: chapters.length, track, gap: GAP }),
		[chapters.length, track],
	);

	if (track <= 0 || !chapters.length) return null;

	return (
		<nav
			className={classes.rail}
			style={{ top, height: track }}
			aria-label="Chapters"
		>
			{chapters.map((chapter, index) => (
				<Mark
					key={chapter.key}
					chapter={chapter}
					top={positions[index] ?? 0}
					current={index === current}
					onClick={() => onChapter(chapter)}
				/>
			))}
		</nav>
	);
}

function Mark({
	chapter,
	top,
	current,
	onClick,
}: {
	chapter: Chapter;
	top: number;
	current: boolean;
	onClick: () => void;
}) {
	const caption = captionOf(chapter);

	return (
		<Tooltip
			position="left"
			withinPortal
			openDelay={80}
			maw={320}
			multiline
			label={
				<>
					<Text size="xs" c="dimmed" fw={500}>
						{caption}
					</Text>
					<Text size="sm" lineClamp={2}>
						{chapter.label}
					</Text>
				</>
			}
		>
			<button
				type="button"
				className={classes.mark}
				style={{ top }}
				aria-label={`${caption}: ${chapter.label}`}
				aria-current={current ? "location" : undefined}
				data-type={chapter.type}
				data-current={current || undefined}
				data-state={chapter.type === "toolCall" ? chapter.state : undefined}
				onClick={onClick}
			/>
		</Tooltip>
	);
}
