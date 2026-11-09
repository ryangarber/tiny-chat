import {
	ActionIcon,
	type ActionIconProps,
	Affix,
	Box,
	type BoxProps,
	Card,
	Center,
	Loader,
	Menu,
	Modal,
	Text,
	Textarea,
	Tooltip,
} from "@mantine/core";
import {
	type UseDisclosureReturnValue,
	useDisclosure,
	useOs,
} from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
	CheckIcon,
	CopyIcon,
	DownloadIcon,
	FloppyDiskIcon,
	FrameCornersIcon,
	MagnifyingGlassMinusIcon,
	MagnifyingGlassPlusIcon,
	PencilSimpleIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	type HTMLAttributes,
	type RefAttributes,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { ClientContext } from "#client/client.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import type { PromiseOr } from "#core/core/types/common.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import ErrorBoundary from "#gui/core/components/ErrorBoundary.tsx";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { useZoom, type ZoomControls } from "#gui/core/hooks/useZoom.ts";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import FindScope from "#gui/features/find/components/FindScope.tsx";
import QuoteActions from "#gui/features/message/components/QuoteActions.tsx";
import { useTextSelection } from "#gui/features/message/hooks/useMessageSelection.ts";

export type ContentFormats<T extends string = string> = T[];

export type ContentFormatter<T extends string = string> = PromiseOr<
	ContentFormatted,
	T
>;
export type ContentFormatterFunction<T extends string = string> = Exclude<
	ContentFormatter<T>,
	ContentFormatted
>;

type ContentFormatted = {
	filename?: string;
	extension?: string;
	mime?: string;
	data: string | Blob;
	html?: string;
};

/** The text a block shows, and where it is written back to once edited. */
export interface ContentEdit {
	value: string;
	save: (value: string) => Promise<void>;
}

/**
 * The block's text in a plain editor, in place of what the block draws. Tab
 * indents rather than leaving it, as in any editor of code; Escape leaves.
 */
function ContentEditor({
	value,
	onChange,
	onSave,
	onCancel,
	saving,
	error,
}: {
	value: string;
	onChange: (value: string) => void;
	onSave: () => void;
	onCancel: () => void;
	saving: boolean;
	error: string | null;
}) {
	return (
		<Textarea
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
			readOnly={saving}
			error={error}
			autoFocus
			spellCheck={false}
			aria-label="File contents"
			flex={1}
			miw={0}
			p="md"
			pt={64}
			styles={{
				root: { display: "flex", flexDirection: "column" },
				wrapper: { flex: 1 },
				input: {
					height: "100%",
					resize: "none",
					fontFamily: "var(--mantine-font-family-monospace)",
					fontSize: "var(--mantine-font-size-sm)",
					tabSize: 4,
				},
			}}
			onKeyDown={(event) => {
				if (
					(event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === "s"
				) {
					event.preventDefault();
					onSave();
				} else if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onCancel();
				} else if (
					event.key === "Tab" &&
					!event.shiftKey &&
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey
				) {
					event.preventDefault();
					const input = event.currentTarget;
					const { selectionStart: start, selectionEnd: end } = input;
					onChange(`${value.slice(0, start)}\t${value.slice(end)}`);
					requestAnimationFrame(() =>
						input.setSelectionRange(start + 1, start + 1),
					);
				}
			}}
		/>
	);
}

function useCopy<T extends string>(
	formatter?: ContentFormatter<T>,
	timeout = 2000,
) {
	const runtime = useRuntime();
	const [isCopied, setCopied] = useState(false);
	const timeoutRef = useRef(0);

	const copy = useCallback(
		async (format: T) => {
			if (!formatter) return;

			try {
				if (!isCopied) {
					const formatted =
						typeof formatter === "function"
							? await formatter(format)
							: formatter;
					await ControlUtils.copy({ runtime, ...formatted });
					setCopied(true);
					timeoutRef.current = window.setTimeout(
						() => setCopied(false),
						timeout,
					);
				}
			} catch (error) {
				console.error("[CopyButton] failed to copy:", error);
			}
		},
		[runtime, isCopied, timeout, formatter],
	);

	useEffect(() => {
		return () => {
			window.clearTimeout(timeoutRef.current);
		};
	}, []);

	return { copy, isCopied };
}

function useDownload<T extends string>(
	formatter?: ContentFormatter<T>,
	timeout = 2000,
) {
	const [isDownloaded, setDownloaded] = useState(false);
	const timeoutRef = useRef(0);

	const download = useCallback(
		async (format: T) => {
			if (!formatter) return;

			try {
				if (!isDownloaded) {
					const formatted =
						typeof formatter === "function"
							? await formatter(format)
							: formatter;
					await ControlUtils.download(formatted);
					timeoutRef.current = window.setTimeout(
						() => setDownloaded(false),
						timeout,
					);
				}
			} catch (error) {
				console.error("[DownloadButton] failed to download:", error);
			}
		},
		[isDownloaded, timeout, formatter],
	);

	useEffect(() => {
		return () => {
			window.clearTimeout(timeoutRef.current);
		};
	}, []);

	return { download, isDownloaded };
}

function ContentActions<T extends string>({
	formats,
	formatter,
	streaming,
	open,
	close,
	zoom,
	onEdit,
	editor,
	withinPortal,
	subtleButtons = true,
}: {
	formats?: ContentFormats<T>;
	formatter?: ContentFormatter<T>;
	streaming?: boolean;
	open?: () => void;
	close?: () => void;
	zoom?: ZoomControls;
	onEdit?: () => void;
	/** While the block is edited: its save and cancel, in place of the rest. */
	editor?: { save: () => void; cancel: () => void; saving: boolean };
	withinPortal?: boolean;
	subtleButtons?: boolean;
}) {
	const { copy, isCopied } = useCopy<T>(formatter);
	const { download, isDownloaded } = useDownload<T>(formatter);
	const os = useOs();

	const actionProps = useMemo<ActionIconProps>(() => {
		return {
			size: "lg",
			variant: "default",
			style: {
				transition: "opacity 200ms ease",
			},
			className: subtleButtons ? "opacity-50 hover:opacity-100" : undefined,
		};
	}, [subtleButtons]);

	if (editor) {
		return (
			<ActionIcon.Group>
				<Tooltip
					label={`Save (${os === "macos" ? "⌘" : "Ctrl+"}S)`}
					withinPortal={withinPortal}
				>
					<ActionIcon
						aria-label="Save"
						loading={editor.saving}
						onClick={editor.save}
						{...actionProps}
					>
						<FloppyDiskIcon size={20} />
					</ActionIcon>
				</Tooltip>
				<Tooltip label="Cancel (Esc)" withinPortal={withinPortal}>
					<ActionIcon
						aria-label="Cancel editing"
						disabled={editor.saving}
						onClick={editor.cancel}
						{...actionProps}
					>
						<XIcon size={20} />
					</ActionIcon>
				</Tooltip>
			</ActionIcon.Group>
		);
	}

	return (
		<ActionIcon.Group>
			{onEdit && (
				<ActionIcon
					aria-label="Edit"
					disabled={streaming}
					onClick={onEdit}
					{...actionProps}
				>
					<PencilSimpleIcon size={20} />
				</ActionIcon>
			)}
			{zoom && (
				<>
					<ActionIcon
						aria-label="Zoom out"
						disabled={!zoom.canZoomOut}
						onClick={zoom.zoomOut}
						{...actionProps}
					>
						<MagnifyingGlassMinusIcon size={20} />
					</ActionIcon>
					<ActionIcon
						aria-label="Reset zoom"
						onClick={zoom.reset}
						{...actionProps}
						w="auto"
						px={6}
					>
						<Text size="xs" miw="4ch" ta="center">
							{Math.round(zoom.zoom * 100)}%
						</Text>
					</ActionIcon>
					<ActionIcon
						aria-label="Zoom in"
						disabled={!zoom.canZoomIn}
						onClick={zoom.zoomIn}
						{...actionProps}
					>
						<MagnifyingGlassPlusIcon size={20} />
					</ActionIcon>
				</>
			)}
			{formats && (
				<>
					<Menu
						withArrow
						withinPortal={withinPortal}
						disabled={formats.length < 2}
					>
						<Menu.Target>
							<ActionIcon
								disabled={streaming}
								{...actionProps}
								onClick={() => {
									if (formats.length === 1) void copy(formats[0]);
								}}
							>
								{isCopied ? <CheckIcon size={20} /> : <CopyIcon size={20} />}
							</ActionIcon>
						</Menu.Target>
						<Menu.Dropdown>
							{formats.map((format) => (
								<Menu.Item key={format} onClick={() => copy(format)}>
									{format}
								</Menu.Item>
							))}
						</Menu.Dropdown>
					</Menu>
					<Menu
						withArrow
						withinPortal={withinPortal}
						disabled={formats.length < 2}
					>
						<Menu.Target>
							<ActionIcon
								disabled={streaming}
								{...actionProps}
								onClick={() => {
									if (formats.length === 1) void download(formats[0]);
								}}
							>
								{isDownloaded ? (
									<CheckIcon size={20} />
								) : (
									<DownloadIcon size={20} />
								)}
							</ActionIcon>
						</Menu.Target>
						<Menu.Dropdown>
							{formats.map((format) => (
								<Menu.Item key={format} onClick={() => download(format)}>
									{format}
								</Menu.Item>
							))}
						</Menu.Dropdown>
					</Menu>
				</>
			)}
			<ActionIcon onClick={open ?? close} {...actionProps}>
				{open && <FrameCornersIcon size={20} />}
				{close && <XIcon size={20} />}
			</ActionIcon>
		</ActionIcon.Group>
	);
}

export default function Content<T extends string>({
	formats,
	formatter,
	streaming,
	children,
	actionsProps,
	disclosure: controlledDisclosure,
	findLabel = "Block",
	findText,
	quote,
	edit,
	...props
}: HTMLAttributes<HTMLDivElement> &
	RefAttributes<HTMLDivElement> &
	BoxProps & {
		formats?: ContentFormats<T>;
		formatter?: ContentFormatter<T>;
		streaming?: boolean;
		actionsProps?: HTMLAttributes<HTMLDivElement> &
			BoxProps &
			Record<string, unknown>;
		disclosure?: UseDisclosureReturnValue;
		/** What the find bar calls it, while it is what find is scoped to. */
		findLabel?: string;
		/** Its text, for content that hides some of what it draws. */
		findText?: () => string[];
		/**
		 * What text selected in it is quoted as coming from, for content shown
		 * on its own rather than in a message: a file's path, or `web:` and a URL.
		 */
		quote?: { source: string };
		/** Lets the block be edited once opened over the whole screen. */
		edit?: ContentEdit;
	}) {
	const client = useContext(ClientContext);
	const scope = useId();
	const selection = useTextSelection(
		quote ? `[data-quote-scope="${scope}"]` : null,
	);
	const quoteScope = quote ? { "data-quote-scope": scope } : {};
	const uncontrolledDisclosure = useDisclosure();
	const [opened, { open, close }] =
		controlledDisclosure ?? uncontrolledDisclosure;
	const {
		setScroller,
		setFrame,
		setContent,
		scrollerStyle,
		frameStyle,
		contentStyle,
		...zoom
	} = useZoom();

	// The text being edited, while the block is.
	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const editable = edit && !streaming ? edit : undefined;
	const editing = !!editable && draft !== null;

	const stopEditing = () => {
		setDraft(null);
		setSaveError(null);
	};
	const save = async () => {
		if (!editable || draft === null || saving) return;
		setSaving(true);
		setSaveError(null);
		try {
			await editable.save(draft);
			stopEditing();
		} catch (error) {
			setSaveError(CommonUtils.formatError({ error }));
		} finally {
			setSaving(false);
		}
	};
	/** Leaves the editor, asking first when that would throw changes away. */
	const leaveEditor = (then?: () => void) => {
		if (saving) return;
		const leave = () => {
			stopEditing();
			then?.();
		};
		if (!editable || draft === null || draft === editable.value) return leave();
		modals.openConfirmModal({
			title: "Discard changes?",
			children: (
				<Text size="sm">Your edits to this file have not been saved.</Text>
			),
			labels: { confirm: "Discard", cancel: "Keep editing" },
			confirmProps: { color: "red" },
			onConfirm: leave,
		});
	};
	const closeModal = () => (editing ? leaveEditor(close) : close());

	return (
		<>
			<Suspense
				fallback={
					<Card p="xl" withBorder>
						<Center>
							<Loader size="sm" />
						</Center>
					</Card>
				}
			>
				<FindScope
					label={findLabel}
					text={findText}
					className="relative selectable"
					style={{
						contentVisibility: "auto",
						containIntrinsicSize: "auto 200px",
					}}
					{...quoteScope}
					{...props}
				>
					{/* As tall as the block, so the buttons in it can stick to the top
					    of whatever scrolls it — the transcript, a panel — until its
					    bottom passes; content scrolled sideways inside it never
					    moves them. Lets presses through everywhere but the buttons. */}
					<div className="pointer-events-none absolute inset-0 z-10">
						<Box
							{...actionsProps}
							className="pointer-events-auto sticky top-1 mt-1 mr-1 ml-auto w-fit"
						>
							<ContentActions
								formats={formats}
								formatter={formatter}
								streaming={streaming}
								open={open}
							/>
						</Box>
					</div>
					<ErrorBoundary label="this block" resetKey={children}>
						{children}
					</ErrorBoundary>
				</FindScope>
			</Suspense>
			<Modal
				opened={opened}
				onClose={closeModal}
				closeOnEscape={!editing}
				withCloseButton={false}
				size="100%"
				centered
				overlayProps={{ blur: 3 }}
				styles={{
					content: {
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					},
					body: { display: "flex", flex: 1, minHeight: 0, padding: 0 },
				}}
			>
				<Affix
					position={{
						top: "calc(20px + env(safe-area-inset-top, 0px))",
						right: "calc(25px + env(safe-area-inset-right, 0px))",
					}}
				>
					<ContentActions
						formats={formats}
						formatter={formatter}
						streaming={streaming}
						close={closeModal}
						zoom={zoom}
						onEdit={
							editable
								? () => {
										setSaveError(null);
										setDraft(editable.value);
									}
								: undefined
						}
						editor={
							editing
								? {
										save: () => void save(),
										cancel: () => leaveEditor(),
										saving,
									}
								: undefined
						}
						subtleButtons={false}
					/>
				</Affix>
				{opened && editing && draft !== null && (
					<ContentEditor
						value={draft}
						onChange={setDraft}
						onSave={() => void save()}
						onCancel={() => leaveEditor()}
						saving={saving}
						error={saveError}
					/>
				)}
				{opened && !editing && (
					<FindScope
						label={findLabel}
						text={findText}
						region
						className="selectable"
						{...quoteScope}
						display="flex"
						flex={1}
						miw={0}
						pos="relative"
					>
						<Box
							ref={setScroller}
							flex={1}
							miw={0}
							style={scrollerStyle}
							data-no-swipe
						>
							<div ref={setFrame} style={frameStyle}>
								<Box ref={setContent} p="md" style={contentStyle}>
									<ErrorBoundary label="this block" resetKey={children}>
										{children}
									</ErrorBoundary>
								</Box>
							</div>
						</Box>
					</FindScope>
				)}
			</Modal>
			{quote && (
				<QuoteActions
					selection={selection}
					onQuote={() => {
						const text = selection.getSelectedText();
						if (text)
							ComposerService.insertQuote({
								client,
								source: quote.source,
								text,
							});
					}}
				/>
			)}
		</>
	);
}
