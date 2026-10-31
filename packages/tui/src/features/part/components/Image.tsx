import { useWindowSize } from "ink";
import _Image, { type ImageProps } from "ink-picture";
import { useContext } from "react";
import Box from "#tui/core/components/Box.tsx";
import Content from "#tui/core/components/Content.tsx";
import Text, { InsideTextContext } from "#tui/core/components/Text.tsx";
import type { Color } from "#tui/core/hooks/useColor.ts";
import { useWidth } from "#tui/core/hooks/useWidth.ts";

const AUTO_SIZE = 854902;

export default function Image({
	width = AUTO_SIZE,
	height = AUTO_SIZE,
	center = true,
	backgroundColor,
	...props
}: Omit<ImageProps, "width" | "height"> & {
	width?: number;
	height?: number;
	center?: boolean;
	backgroundColor?: Color;
}) {
	const { rows } = useWindowSize();
	const columns = useWidth();
	const insideText = useContext(InsideTextContext);

	// An image drawn inside text — a badge inside a link, an icon mid-sentence —
	// has no box of its own to draw in, so it stands as its alt text instead.
	if (insideText) {
		return <Text color="textSubtle">[{props.alt || "image"}]</Text>;
	}

	if (width === AUTO_SIZE) {
		width = Math.floor(columns / 2);
	}
	if (height === AUTO_SIZE) {
		height = Math.floor(rows / 2);
	}

	const image = (
		<_Image {...props} width={width} height={height} objectFit="contain" />
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
