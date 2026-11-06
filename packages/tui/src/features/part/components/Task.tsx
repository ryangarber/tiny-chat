import { useAnimation } from "ink";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { ThemeContext } from "#client/core/components/ThemeContext.tsx";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import {
	type StatusPart,
	TaskUtils,
} from "#tui/features/part/utils/TaskUtils.ts";

interface TaskContext {
	expanded: boolean;
	setExpanded?: (value: boolean) => void;
}

const TaskContext = createContext<TaskContext>({ expanded: false });

function Task({
	children,
	expanded: controlledExpanded,
	onToggle,
	...props
}: BoxProps & {
	children: ReactNode;
	/** Controls whether the details show, instead of the task holding it. */
	expanded?: boolean;
	onToggle?: () => void;
}) {
	const context = useContext(TaskContext);

	const [expandedState, setExpandedState] = useState(false);
	const expanded = controlledExpanded ?? expandedState;
	const setExpanded = useCallback(
		(value: boolean) => (onToggle ? onToggle() : setExpandedState(value)),
		[onToggle],
	);

	const mergedContext = useMemo<TaskContext>(
		() => ({ ...context, expanded, setExpanded }),
		[context, expanded, setExpanded],
	);

	return (
		<TaskContext value={mergedContext}>
			<Box flexDirection="column" paddingX={1} {...props}>
				{children}
			</Box>
		</TaskContext>
	);
}

namespace Task {
	export function Group({
		children,
		...props
	}: BoxProps & {
		children: ReactNode;
	}) {
		return (
			<Box flexDirection="column" gap={1} {...props}>
				{children}
			</Box>
		);
	}

	export function Status({
		emoji,
		status,
		parts,
	}: {
		emoji?: string;
		status: "pending" | "success" | "error";
		parts: StatusPart[];
	}) {
		const { colorScheme } = useContext(ThemeContext);

		const { expanded, setExpanded } = useContext(TaskContext);
		if (!setExpanded) throw new Error("missing task context");

		const [hovered, setHovered] = useState(false);

		const { mouseRef } = useMouseInput({
			onClick: ({ event }) => {
				if (event.type === "down" && event.button === "left") {
					setExpanded(!expanded);
				}
			},
			onHoverStart: () => {
				setHovered(true);
			},
			onHoverEnd: () => {
				setHovered(false);
			},
			isActive: true,
		});

		// Only a pending task shimmers, so only one ticks: every tick is a frame
		// for the whole screen, and a settled one would draw it the same each time.
		const shimmer = useAnimation({
			interval: 200,
			isActive: status === "pending",
		});
		const offset = useMemo(() => Math.random() * 1000, []);

		const current = status === "pending" ? shimmer : null;

		const text = useMemo(() => {
			if (status === "error") {
				return TaskUtils.plain({
					parts,
					style: (style) => (hovered ? style.red.dim : style.red),
					join: " ",
				});
			}
			if (current) {
				return TaskUtils.shimmer({
					parts,
					style: (style) => (hovered ? style.dim : style),
					time: current.time,
					offset,
				});
			}
			return TaskUtils.plain({
				parts,
				style: (style) =>
					hovered
						? style.hex(colorScheme.textSubtle).dim
						: style.hex(colorScheme.textSubtle),
				join: " ",
			});
		}, [hovered, offset, current, status, parts, colorScheme.textSubtle]);

		// The emoji is held to its width, and set off by a margin rather than a
		// trailing space, so the gap stays put when the text wraps against the
		// edge instead of being squeezed out of it.
		return (
			<Box ref={mouseRef} flexShrink={1}>
				<Box flexShrink={0} marginRight={1}>
					<Text color="textSubtle">{emoji ?? " "}</Text>
				</Box>
				<Text>{text}</Text>
			</Box>
		);
	}

	export function Details({
		children,
		collapse = true,
		...props
	}: BoxProps & {
		children: ReactNode;
		collapse?: boolean;
	}) {
		const { expanded, setExpanded } = useContext(TaskContext);

		const [hovered, setHovered] = useState(false);
		const { mouseRef } = useMouseInput({
			onClick: ({ event }) => {
				if (event.type === "down" && event.button === "left") {
					setHovered(false);
					setExpanded?.(false);
				}
			},
			onHoverStart: () => {
				setHovered(true);
			},
			onHoverEnd: () => {
				setHovered(false);
			},
			isActive: !!setExpanded,
		});

		if (collapse && !expanded) {
			return null;
		}

		// The line down its left side is a column of its own, so it can be
		// pointed at: it lights up under the pointer and closes the task when
		// clicked.
		return (
			<Box flexDirection="row">
				<Box
					ref={mouseRef}
					flexShrink={0}
					width={1}
					borderStyle="single"
					borderLeft={true}
					borderColor={hovered ? "textSubtle" : undefined}
				/>
				<Box
					flexDirection="column"
					flexGrow={1}
					flexShrink={1}
					paddingY={1}
					paddingLeft={2}
					{...props}
				>
					{children}
				</Box>
			</Box>
		);
	}
}

export default Task;
