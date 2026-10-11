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
} from "@mantine/core";
import { type UseDisclosureReturnValue, useDisclosure } from "@mantine/hooks";
import {
	CheckIcon,
	CopyIcon,
	DownloadIcon,
	FrameCornersIcon,
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
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";

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
	withinPortal,
	subtleButtons = true,
}: {
	formats?: ContentFormats<T>;
	formatter?: ContentFormatter<T>;
	streaming?: boolean;
	open?: () => void;
	close?: () => void;
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
	}) {
	const uncontrolledDisclosure = useDisclosure();
	const [opened, { open, close }] =
		controlledDisclosure ?? uncontrolledDisclosure;

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
				<Box
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
				</Box>
			</Suspense>
			<Modal
				opened={opened}
				onClose={close}
				withCloseButton={false}
				size="100%"
				centered
				overlayProps={{ blur: 3 }}
			>
				<Affix top={20} right={25}>
					<ContentActions
						formats={formats}
						formatter={formatter}
						streaming={streaming}
						close={close}
						subtleButtons={false}
					/>
				</Affix>
				{opened && <Box className="selectable">{children}</Box>}
			</Modal>
		</>
	);
}
