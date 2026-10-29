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
} from "@mantine/core";
import { type UseDisclosureReturnValue, useDisclosure } from "@mantine/hooks";
import {
	CheckIcon,
	CopyIcon,
	DownloadIcon,
	FrameCornersIcon,
	MagnifyingGlassMinusIcon,
	MagnifyingGlassPlusIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	type HTMLAttributes,
	type RefAttributes,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { PromiseOr } from "#core/core/types/common.ts";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { useZoom, type ZoomControls } from "#gui/core/hooks/useZoom.ts";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import FindScope from "#gui/features/find/components/FindScope.tsx";

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
	withinPortal,
	subtleButtons = true,
}: {
	formats?: ContentFormats<T>;
	formatter?: ContentFormatter<T>;
	streaming?: boolean;
	open?: () => void;
	close?: () => void;
	zoom?: ZoomControls;
	withinPortal?: boolean;
	subtleButtons?: boolean;
}) {
	const { copy, isCopied } = useCopy<T>(formatter);
	const { download, isDownloaded } = useDownload<T>(formatter);

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

	return (
		<ActionIcon.Group>
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
	}) {
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
					{...props}
				>
					<Box {...actionsProps} className="absolute top-1 right-1">
						<ContentActions
							formats={formats}
							formatter={formatter}
							streaming={streaming}
							open={open}
						/>
					</Box>
					{children}
				</FindScope>
			</Suspense>
			<Modal
				opened={opened}
				onClose={close}
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
						close={close}
						zoom={zoom}
						subtleButtons={false}
					/>
				</Affix>
				{opened && (
					<FindScope
						label={findLabel}
						text={findText}
						region
						className="selectable"
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
									{children}
								</Box>
							</div>
						</Box>
					</FindScope>
				)}
			</Modal>
		</>
	);
}
