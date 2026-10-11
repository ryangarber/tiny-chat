import { type DOMElement, useInput, useWindowSize } from "ink";
import {
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
} from "react";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import ScrollView, {
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";
import { useContentStore } from "#tui/core/stores/useContentStore.ts";

/** Text is copied as is; bytes are copied as an encoded image. */
type ContentFormatted = string | Uint8Array;

export type ContentFormatter = () =>
	| ContentFormatted
	| Promise<ContentFormatted>;

/** `[copy]`, and `[+]` to open the block over the whole screen or `[×]` to close it. */
function ContentActions({
	formatter,
	streaming,
	open,
	close,
}: {
	formatter?: ContentFormatter;
	streaming?: boolean;
	open?: () => void;
	close?: () => void;
}) {
	const copy = async () => {
		if (!formatter) return;
		try {
			const formatted = await formatter();
			if (typeof formatted === "string") ClipboardService.copy(formatted);
			else ClipboardService.copyImage(formatted);
		} catch (error) {
			console.warn("[Content] failed to copy", error);
		}
	};

	return (
		<Box position="absolute" top={1} right={2} gap={1}>
			{formatter && !streaming && (
				<Button label="copy" labelOnClick="copied" onClick={copy} />
			)}
			<Button label={open ? "+" : "×"} onClick={open ?? close} />
		</Box>
	);
}

/**
 * Wraps a block of content (code, a table, an image, …) with a `[copy]`
 * button in its top right corner, and a `[+]` that draws the same block over
 * the whole screen, where it scrolls on its own.
 *
 * The app offers every format to copy or download; here only the block's first
 * format is copied, so `formatter` produces just that one.
 */
export default function Content({
	formatter,
	streaming,
	children,
	...props
}: BoxProps & {
	formatter?: ContentFormatter;
	/** The content is still coming in, so there is nothing whole to copy. */
	streaming?: boolean;
	children?: ReactNode;
}) {
	const id = useId();
	// Only whether this block is the one open is read, so a block renders no
	// more often than it did before for being able to open.
	const opened = useContentStore((state) => state.open?.id === id);

	const open = () =>
		useContentStore
			.getState()
			.openContent({ id, formatter, streaming, children });

	// Kept up with while open, so content still streaming in grows there too.
	// Unmounted while open — as what it sits in may be, once the page goes
	// fullscreen — it stays open with the children it last had.
	useLayoutEffect(() => {
		if (!opened) return;
		useContentStore
			.getState()
			.updateContent({ id, formatter, streaming, children });
	});

	return (
		<Box
			flexDirection="column"
			width="100%"
			borderStyle="round"
			border={true}
			{...props}
		>
			{children}
			<ContentActions formatter={formatter} streaming={streaming} open={open} />
		</Box>
	);
}

/**
 * The block opened with `[+]`, over everything else and alone taking the
 * mouse. Mounted only while one is open, it draws the very children that
 * block was given rather than a copy of them.
 */
export function ContentFullscreen() {
	const { rows, columns } = useWindowSize();
	const content = useContentStore((state) => state.open);
	const closeContent = useContentStore((state) => state.closeContent);

	const ref = useRef<DOMElement>(null);
	const scrollRef =
		useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);

	useMouseLayer(ref, !!content);

	// Left some other way than closing it, the block is let go of all the same.
	useEffect(() => () => useContentStore.setState({ open: null }), []);

	usePage({
		onBack: () => {
			closeContent();
			return false;
		},
	});

	useInput((_input, key) => {
		const page = Math.max(1, (scrollRef.current?.getViewportHeight() ?? 1) - 2);
		if (key.upArrow) scrollRef.current?.scrollBy(-1);
		if (key.downArrow) scrollRef.current?.scrollBy(1);
		if (key.pageUp) scrollRef.current?.scrollBy(-page);
		if (key.pageDown) scrollRef.current?.scrollBy(page);
	});

	if (!content) return null;

	return (
		<Box
			ref={ref}
			position="absolute"
			top={0}
			left={0}
			width={columns}
			height={rows}
			flexDirection="column"
			// A block shorter than the screen sits in the middle of it.
			justifyContent="center"
			paddingX={6}
			paddingY={2}
			backgroundColor="surface"
		>
			<Box
				flexDirection="column"
				flexShrink={1}
				minHeight={0}
				borderStyle="round"
				border={true}
			>
				<ScrollView
					ref={scrollRef}
					flexShrink={1}
					minHeight={0}
					overscan={Number.POSITIVE_INFINITY}
				>
					{content.children}
				</ScrollView>
				<ContentActions
					formatter={content.formatter}
					streaming={content.streaming}
					close={closeContent}
				/>
			</Box>
		</Box>
	);
}
