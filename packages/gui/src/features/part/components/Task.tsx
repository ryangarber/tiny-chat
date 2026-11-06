import {
	ActionIcon,
	Box,
	type BoxProps,
	Collapse,
	type GroupProps,
	Image,
	Group as MantineGroup,
	Text,
	Tooltip,
} from "@mantine/core";
import { CaretRightIcon, StopCircleIcon } from "@phosphor-icons/react";
import {
	createContext,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import type { ToolStatusPart } from "#core/features/tool/types/display.ts";
import type { ToolCallImage } from "#core/features/tool/utils/ToolCallUtils.ts";

/** Thumbnails shown on a status line before the rest are counted. */
const MAX_THUMBNAILS = 4;

interface TaskContext {
	expanded: boolean;
	/** Absent for a task with nothing to fold away. */
	setExpanded?: (value: boolean) => void;
}

const TaskContext = createContext<TaskContext>({ expanded: false });

/**
 * Something done along the way — a tool call, a run of them, a thought — drawn
 * as a status line that opens onto its details. Mirrors the CLI's `Task`.
 */
function Task({
	children,
	expanded: controlledExpanded,
	onToggle,
	collapsible = true,
	ref,
	...props
}: BoxProps & {
	children: ReactNode;
	/** Controls whether the details show, instead of the task holding it. */
	expanded?: boolean;
	onToggle?: () => void;
	/** Whether there is anything to open; without it the status is inert. */
	collapsible?: boolean;
	ref?: Ref<HTMLDivElement>;
}) {
	const [expandedState, setExpandedState] = useState(false);
	const expanded = collapsible && (controlledExpanded ?? expandedState);
	const setExpanded = useCallback(
		(value: boolean) => (onToggle ? onToggle() : setExpandedState(value)),
		[onToggle],
	);

	const context = useMemo<TaskContext>(
		() => ({ expanded, setExpanded: collapsible ? setExpanded : undefined }),
		[expanded, setExpanded, collapsible],
	);

	return (
		<TaskContext value={context}>
			<Box my={8} ref={ref} {...props}>
				{children}
			</Box>
		</TaskContext>
	);
}

namespace Task {
	/** Tasks drawn together, such as the calls of one run. */
	export function Group({
		children,
		...props
	}: BoxProps & { children: ReactNode }) {
		return <Box {...props}>{children}</Box>;
	}

	/** The line a task folds to, which opens and closes it. */
	export function Status({
		icon,
		status,
		parts,
		children,
		style,
		...props
	}: Omit<GroupProps, "children"> & {
		icon: ReactNode;
		status: "pending" | "success" | "error";
		parts: ToolStatusPart[];
		/** Drawn after the status, such as thumbnails or a stop button. */
		children?: ReactNode;
	}) {
		const { expanded, setExpanded } = useContext(TaskContext);

		return (
			<MantineGroup
				className={`group shimmer-text ${status === "pending" ? "active" : ""}`}
				onClick={setExpanded && (() => setExpanded(!expanded))}
				style={{ cursor: setExpanded ? "pointer" : undefined, ...style }}
				gap="xs"
				wrap="nowrap"
				{...props}
			>
				{icon}
				<Text truncate="end" c={status === "error" ? "red" : undefined} miw={0}>
					{parts.map((part, index) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: parts stay in order
							key={index}
							style={part.subject ? { fontWeight: 500 } : undefined}
						>
							{index > 0 && " "}
							{part.text}
						</span>
					))}
				</Text>
				{setExpanded && (
					<CaretRightIcon
						size={14}
						color="var(--mantine-color-dimmed)"
						className="shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-100"
						style={{ transform: expanded ? "rotate(90deg)" : undefined }}
					/>
				)}
				{children}
			</MantineGroup>
		);
	}

	/** Small previews of the images a task produced, at the line's end. */
	export function Thumbnails({ images }: { images: ToolCallImage[] }) {
		if (!images.length) return null;
		const shown = images.slice(0, MAX_THUMBNAILS);
		const rest = images.length - shown.length;

		return (
			<MantineGroup gap={4} wrap="nowrap" ml="auto" className="shrink-0">
				{shown.map((image, index) => (
					<Image
						// biome-ignore lint/suspicious/noArrayIndexKey: images stay in order
						key={index}
						src={image.src}
						alt={image.name ?? "image"}
						w={24}
						h={24}
						fit="cover"
						radius="sm"
						className="border border-border"
					/>
				))}
				{rest > 0 && (
					<Text size="xs" c="dimmed">
						+{rest}
					</Text>
				)}
			</MantineGroup>
		);
	}

	/** Stops the task while it runs. */
	export function Stop({ onClick }: { onClick: () => void }) {
		return (
			<Tooltip label="Stop" openDelay={300}>
				<ActionIcon
					variant="subtle"
					color="gray"
					size="sm"
					aria-label="Stop"
					className="shrink-0"
					onClick={(event) => {
						event.stopPropagation();
						onClick();
					}}
				>
					<StopCircleIcon size={18} />
				</ActionIcon>
			</Tooltip>
		);
	}

	/**
	 * What a task opens onto, set off by a line down its left side that
	 * closes it again when clicked.
	 */
	export function Details({
		children,
		collapse = true,
		...props
	}: BoxProps & {
		children: ReactNode;
		/** Whether it folds away with the task, rather than always showing. */
		collapse?: boolean;
	}) {
		const { expanded, setExpanded } = useContext(TaskContext);

		return (
			<Collapse expanded={!collapse || expanded} keepMounted={false}>
				<Box
					pos="relative"
					ml={9}
					mt={4}
					py="xs"
					pl="calc(var(--mantine-spacing-md) + 2px)"
					{...props}
				>
					{setExpanded ? (
						<button
							type="button"
							className="task-line"
							aria-label="Collapse"
							onClick={() => setExpanded(false)}
						/>
					) : (
						<span className="task-line" />
					)}
					{children}
				</Box>
			</Collapse>
		);
	}
}

export default Task;
