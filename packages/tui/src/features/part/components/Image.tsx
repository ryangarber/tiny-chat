import { Image as _Image } from "better-ink-picture";
import { Transform, useWindowSize } from "ink";
import { useContext, useEffect, useState } from "react";
import link from "terminal-link";
import { ThemeContext } from "#client/core/components/ThemeContext.tsx";
import { useThemes } from "#client/features/settings/hooks/useThemes.ts";
import Box from "#tui/core/components/Box.tsx";
import Content from "#tui/core/components/Content.tsx";
import Text, { InsideTextContext } from "#tui/core/components/Text.tsx";
import type { Color } from "#tui/core/hooks/useColor.ts";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { useWidth } from "#tui/core/hooks/useWidth.ts";
import { OpenerService } from "#tui/core/services/OpenerService.ts";
import {
	ImageFileService,
	type ImageSource,
} from "#tui/features/part/services/ImageFileService.ts";

const AUTO_SIZE = 854902;

/**
 * An image stood as a link that opens it in the system's default app: its
 * file, its URL, or a temp file written from its data.
 */
function ImageLink({
	src,
	path,
	alt,
}: {
	src: ImageSource;
	path?: string;
	alt?: string;
}) {
	const { colorScheme } = useContext(ThemeContext);
	// Kept with the source it was found for, so a new one is not opened as the old.
	const [located, setLocated] = useState<{
		src: ImageSource;
		url: string;
	}>();
	const url = located?.src === src ? located.url : undefined;
	const [hover, setHover] = useState(false);

	useEffect(() => {
		let cancelled = false;
		ImageFileService.url(src, path).then(
			(next) => !cancelled && setLocated({ src, url: next }),
			(error) => console.warn("[Image] could not locate image", error),
		);
		return () => {
			cancelled = true;
		};
	}, [src, path]);

	const { mouseRef } = useMouseInput({
		onClick: () => url && OpenerService.open(url),
		onHoverStart: () => setHover(true),
		onHoverEnd: () => setHover(false),
		isActive: !!url,
	});

	const name = alt || path?.split(/[\\/]/).pop() || "image";
	const label = (
		<Text color={url ? colorScheme.primary : "textSubtle"} underline={hover}>
			[image: {name}]
		</Text>
	);

	return (
		<Box ref={(element) => mouseRef(element, 0)} flexShrink={0}>
			{url ? (
				<Transform transform={(text) => link(text, url, { fallback: false })}>
					{label}
				</Transform>
			) : (
				label
			)}
		</Box>
	);
}

export default function Image({
	width = AUTO_SIZE,
	height = AUTO_SIZE,
	center = true,
	backgroundColor,
	path,
	...props
}: {
	src: ImageSource;
	alt?: string;
	/** The image's file on this machine, opened in place of a copy of it. */
	path?: string;
	/** Most columns to take; half the column by default. */
	width?: number;
	/** Most rows to take; half the terminal by default. */
	height?: number;
	center?: boolean;
	backgroundColor?: Color;
}) {
	const { rows } = useWindowSize();
	const columns = useWidth();
	const insideText = useContext(InsideTextContext);
	const { tuiImages } = useThemes();

	// An image drawn inside text — a badge inside a link, an icon mid-sentence —
	// has no box of its own to draw in, so it stands as its alt text instead.
	if (insideText) {
		return <Text color="textSubtle">[{props.alt || "image"}]</Text>;
	}

	if (tuiImages === "none") {
		return <ImageLink src={props.src} path={path} alt={props.alt} />;
	}

	if (width === AUTO_SIZE) {
		width = Math.floor(columns / 2);
	}
	if (height === AUTO_SIZE) {
		height = Math.floor(rows / 2);
	}

	// Fit inside both, keeping its aspect ratio and never past its own size. A
	// terminal that can't draw it gets the same link `none` does.
	const image = (
		<_Image
			src={
				props.src instanceof ArrayBuffer ? new Uint8Array(props.src) : props.src
			}
			alt={props.alt}
			width={width}
			height={height}
			fallback={() => <ImageLink src={props.src} path={path} alt={props.alt} />}
		/>
	);

	// the original image, as the app copies it
	const formatter = async () =>
		typeof props.src === "string"
			? new Uint8Array(await (await fetch(props.src)).arrayBuffer())
			: new Uint8Array(props.src);

	return (
		<Content formatter={formatter} backgroundColor={backgroundColor}>
			{center ? (
				<Box
					flexGrow={1}
					justifyContent="center"
					backgroundColor={backgroundColor}
				>
					{image}
				</Box>
			) : (
				image
			)}
		</Content>
	);
}
