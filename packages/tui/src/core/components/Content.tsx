import { type DOMElement, useInput, useWindowSize } from "ink";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import ErrorBoundary from "#tui/core/components/ErrorBoundary.tsx";
import HelpText from "#tui/core/components/HelpText.tsx";
import ScrollView, {
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useScrollSticky } from "#tui/core/hooks/useScrollSticky.ts";
import { WidthContext } from "#tui/core/hooks/useWidth.ts";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";
import { selectFocus, useAppStore } from "#tui/core/stores/useAppStore.ts";
import { useContentStore } from "#tui/core/stores/useContentStore.ts";
import { TextLayoutUtils } from "#tui/core/utils/TextLayoutUtils.ts";
import Find from "#tui/features/find/components/Find.tsx";
import FindScope from "#tui/features/find/components/FindScope.tsx";
import Selectable from "#tui/features/selection/components/Selectable.tsx";
import Textarea from "#tui/features/textarea/components/Textarea.tsx";

/** The scope, and the find bar's id, of the block opened over the screen. */
const FULLSCREEN = "fullscreen";

/** Room on either side of the open block, between it and the screen's edge. */
const FULLSCREEN_PADDING_X = 6;

/**
 * Columns inside the border of the block opened over the screen, for content
 * that sizes itself to fill it; unset for a block drawn in its message.
 */
export const ContentWidthContext = createContext<number | null>(null);

const NO_BLOCK: RefObject<DOMElement | null> = { current: null };

/** Text is copied as is; bytes are copied as an encoded image. */
type ContentFormatted = string | Uint8Array;

export type ContentFormatter = () =>
	| ContentFormatted
	| Promise<ContentFormatted>;

/** The text a block shows, and where it is written back to once edited. */
export interface ContentEdit {
	value: string;
	save: (value: string) => Promise<void>;
}

/** Rows around the editor: the screen's padding, the border, its own padding and the keys below. */
const EDITOR_CHROME_ROWS = 10;

/**
 * `[copy]`, and `[+]` to open the block over the whole screen or `[×]` to
 * close it — with `[edit]` there, for a block that can be written back; while
 * it is edited, `[save]` and `[cancel]` instead.
 */
function ContentActions({
	formatter,
	streaming,
	open,
	close,
	onEdit,
	editor,
	blockRef,
}: {
	formatter?: ContentFormatter;
	streaming?: boolean;
	open?: () => void;
	close?: () => void;
	onEdit?: () => void;
	editor?: { save: () => void; cancel: () => void; saving: boolean };
	/**
	 * The block they are drawn over, down which they follow the top of what is
	 * shown of it as the view it is in scrolls; left out, they stay at its top.
	 */
	blockRef?: RefObject<DOMElement | null>;
}) {
	const top = useScrollSticky(blockRef ?? NO_BLOCK, { min: 1 });

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
		// Drawn over the block, but never found or selected as part of it.
		<Box
			// biome-ignore lint/nursery/useReactCompiler: a ref callback that only marks the node it is handed.
			ref={TextLayoutUtils.ignore}
			position="absolute"
			top={top}
			right={2}
			gap={1}
		>
			{editor ? (
				<>
					<Button
						label={editor.saving ? "saving…" : "save"}
						disabled={editor.saving}
						onClick={editor.save}
					/>
					<Button
						label="cancel"
						disabled={editor.saving}
						onClick={editor.cancel}
					/>
				</>
			) : (
				<>
					{formatter && !streaming && (
						<Button label="copy" labelOnClick="copied" onClick={copy} />
					)}
					{onEdit && !streaming && <Button label="edit" onClick={onEdit} />}
					<Button label={open ? "+" : "×"} onClick={open ?? close} />
				</>
			)}
		</Box>
	);
}

/**
 * Wraps a block of content (code, a table, an image, …) with a `[copy]`
 * button in its top right corner, and a `[+]` that draws the same block over
 * the whole screen, where it scrolls on its own.
 *
 * The buttons follow the top of what is shown of the block as the view it is
 * in scrolls, so a long one can be copied or opened from anywhere in it.
 *
 * The app offers every format to copy or download; here only the block's first
 * format is copied, so `formatter` produces just that one.
 */
export default function Content({
	formatter,
	streaming,
	findLabel = "block",
	edit,
	contentId,
	children,
	...props
}: BoxProps & {
	formatter?: ContentFormatter;
	/** The content is still coming in, so there is nothing whole to copy. */
	streaming?: boolean;
	/** What the find bar calls it, while it is what find is scoped to. */
	findLabel?: string;
	/** Lets the block be edited once opened over the whole screen. */
	edit?: ContentEdit;
	/**
	 * Who it is while open, for blocks that stand in for one another — a file
	 * drawn as code, then as a diff once saved — so the open one follows.
	 */
	contentId?: string;
	children?: ReactNode;
}) {
	const generatedId = useId();
	const id = contentId ?? generatedId;
	const blockRef = useRef<DOMElement>(null);
	// Only whether this block is the one open is read, so a block renders no
	// more often than it did before for being able to open.
	const opened = useContentStore((state) => state.open?.id === id);

	const open = () =>
		useContentStore
			.getState()
			.openContent({ id, formatter, streaming, findLabel, edit, children });

	// Kept up with while open, so content still streaming in grows there too.
	// Unmounted while open — as what it sits in may be, once the page goes
	// fullscreen — it stays open with the children it last had.
	useLayoutEffect(() => {
		if (!opened) return;
		useContentStore
			.getState()
			.updateContent({ id, formatter, streaming, findLabel, edit, children });
	});

	return (
		<FindScope
			ref={blockRef}
			label={findLabel}
			flexDirection="column"
			width="100%"
			borderStyle="round"
			border={true}
			{...props}
		>
			<Selectable>{children}</Selectable>
			<ContentActions
				formatter={formatter}
				streaming={streaming}
				open={open}
				blockRef={blockRef}
			/>
		</FindScope>
	);
}

/**
 * The block opened with `[+]`, over everything else and alone taking the
 * mouse. Mounted only while one is open, it draws the very children that
 * block was given rather than a copy of them.
 *
 * A block that can be edited takes `e` or `[edit]` to swap what it draws for
 * its text in an editor, saved with Ctrl+S and left with Escape — pressed
 * twice, when there are changes it would throw away.
 */
export function ContentFullscreen() {
	const { rows, columns } = useWindowSize();
	const content = useContentStore((state) => state.open);
	const closeContent = useContentStore((state) => state.closeContent);
	// The keys are the find bar's while it has them, over this page.
	const active = useAppStore((state) => selectFocus(state) === "fullscreen");

	const ref = useRef<DOMElement>(null);
	const scrollRef =
		useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);

	// The text being edited, held by the block it was opened from.
	const [draft, setDraft] = useState<{ id: string; value: string } | null>(
		null,
	);
	const [status, setStatus] = useState<
		"saving" | "confirm" | { error: string } | null
	>(null);
	const edit = content && !content.streaming ? content.edit : undefined;
	const editing = edit && draft?.id === content?.id ? draft : null;

	const startEditing = () => {
		if (!content || !edit) return;
		setStatus(null);
		setDraft({ id: content.id, value: edit.value });
	};
	const stopEditing = () => {
		setDraft(null);
		setStatus(null);
	};
	const save = async () => {
		if (!edit || !editing || status === "saving") return;
		setStatus("saving");
		try {
			await edit.save(editing.value);
			stopEditing();
		} catch (error) {
			setStatus({ error: CommonUtils.formatError({ error }) });
		}
	};
	const cancel = () => {
		if (!edit || !editing || status === "saving") return;
		if (editing.value !== edit.value && status !== "confirm") {
			setStatus("confirm");
			return;
		}
		stopEditing();
	};

	useMouseLayer(ref, !!content);

	// Left some other way than closing it, the block is let go of all the same.
	useEffect(() => () => useContentStore.setState({ open: null }), []);

	// Escape and Backspace are the editor's while it is open.
	usePage({
		active: active && !editing,
		onBack: () => {
			closeContent();
			return false;
		},
	});

	useInput(
		(input, key) => {
			if (key.upArrow) scrollRef.current?.scrollBy(-1);
			if (key.downArrow) scrollRef.current?.scrollBy(1);
			if (input === "e" && !key.ctrl && !key.meta && edit) startEditing();
		},
		{ isActive: active && !editing },
	);

	if (!content) return null;

	// Less the padding either side, and the block's border.
	const width = columns - FULLSCREEN_PADDING_X * 2 - 2;

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
			paddingX={FULLSCREEN_PADDING_X}
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
				<FindScope
					id={FULLSCREEN}
					label={content.findLabel ?? "block"}
					region
					flexShrink={1}
					minHeight={0}
				>
					{/* What sizes itself to the transcript sizes itself to the block instead. */}
					<WidthContext.Provider value={width}>
						<ContentWidthContext.Provider value={width}>
							{editing ? (
								<Box
									flexDirection="column"
									paddingX={2}
									paddingY={1}
									flexShrink={1}
									minHeight={0}
								>
									<Textarea
										value={editing.value}
										onChange={(value) => {
											setDraft({ id: editing.id, value });
											if (status !== "saving") setStatus(null);
										}}
										focus={active && status !== "saving"}
										maxRows={Math.max(1, rows - EDITOR_CHROME_ROWS)}
										onKey={(input, key) => {
											if (key.escape) {
												cancel();
												return true;
											}
											if (key.ctrl && input === "s") {
												void save();
												return true;
											}
											return false;
										}}
										onSubmit={() => void save()}
									/>
								</Box>
							) : (
								<ScrollView
									ref={scrollRef}
									paging={active}
									flexShrink={1}
									minHeight={0}
									overscan={Number.POSITIVE_INFINITY}
								>
									<ErrorBoundary label="this block" resetKey={content.children}>
										<Selectable>{content.children}</Selectable>
									</ErrorBoundary>
								</ScrollView>
							)}
						</ContentWidthContext.Provider>
					</WidthContext.Provider>
				</FindScope>
				<ContentActions
					formatter={content.formatter}
					streaming={content.streaming}
					close={closeContent}
					onEdit={edit && startEditing}
					editor={
						editing
							? {
									save: () => void save(),
									cancel,
									saving: status === "saving",
								}
							: undefined
					}
				/>
			</Box>
			{editing && (
				<Box flexDirection="column" paddingX={1} flexShrink={0}>
					{typeof status === "object" && status && (
						<Text color="redBright" wrap="truncate-end">
							{status.error}
						</Text>
					)}
					<HelpText
						actions={[
							{
								key: "ctrl+s",
								name: status === "saving" ? "saving…" : "save",
								onClick: () => void save(),
							},
							{
								key: "esc",
								name:
									status === "confirm" ? "again to discard changes" : "cancel",
								onClick: cancel,
							},
						]}
					/>
				</Box>
			)}
			<Find id={FULLSCREEN} targetRef={ref} root={FULLSCREEN} fixed />
		</Box>
	);
}
