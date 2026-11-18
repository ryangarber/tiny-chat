import {
	Box,
	type BoxProps,
	FocusTarget,
	type FocusTargetOptions,
	Text,
	useFocusContext,
} from "better-ink-ui";
import { useInput } from "ink";
import type { ReactNode } from "react";
import Button from "#tui/core/components/Button.tsx";
import {
	type Focusable,
	focusOrder,
	useCurrentPage,
} from "#tui/core/stores/useAppStore.ts";

/**
 * Whether the panel something is drawn in has the focus. Outside of any panel
 * — on a page, which has the keys to itself — it always does.
 */
export const usePanel = () => ({ focused: useFocusContext().isFocused });

/**
 * Something on the chat page that takes the keys in turn: Tab moves between
 * those on screen, in the order of `focusOrder`, and a press anywhere in one
 * focuses it. What it draws reads whether it is focused through `usePanel`.
 *
 * Visibility is independent of focus; only an explicit close hides a panel.
 */
export default function Panel({
	id,
	title,
	closable = false,
	onClose,
	disabled = false,
	sink,
	onTab,
	children,
	...props
}: Omit<BoxProps, "id"> &
	Pick<FocusTargetOptions, "sink" | "onTab"> & {
		id: Focusable;
		/** Drawn in a header, in the primary color while focused. */
		title?: ReactNode;
		/** Shows an `x` to close it, which the `x` key presses while focused. */
		closable?: boolean;
		onClose?: () => void;
		/** Neither focused by a press nor reached with Tab. */
		disabled?: boolean;
		children: ReactNode;
	}) {
	// A press on the chat under a page leaves the page up.
	const onChat = useCurrentPage() === "chat";
	return (
		<FocusTarget
			id={id}
			order={focusOrder(id)}
			disabled={disabled}
			sink={sink}
			onTab={onTab}
			focusOnClick={onChat}
			{...props}
		>
			{(title !== undefined || closable) && (
				<PanelHeader
					title={title}
					closable={closable}
					onClose={onClose}
					disabled={disabled}
				/>
			)}
			{children}
		</FocusTarget>
	);
}

function PanelHeader({
	title,
	closable,
	onClose,
	disabled,
}: {
	title?: ReactNode;
	closable: boolean;
	onClose?: () => void;
	disabled: boolean;
}) {
	const { focused } = usePanel();

	useInput(
		(input, key) => {
			if (input === "x" && !key.ctrl && !key.meta) onClose?.();
		},
		{ isActive: focused && closable },
	);

	return (
		<Box paddingX={1} gap={1} flexShrink={0}>
			<Box flexGrow={1} minWidth={0}>
				{typeof title === "string" ? (
					<Text
						bold
						wrap="truncate-end"
						color={focused ? "primary" : "textSubtle"}
						dimColor={disabled}
					>
						{title}
					</Text>
				) : (
					title
				)}
			</Box>
			{closable && <Button label="×" disabled={disabled} onClick={onClose} />}
		</Box>
	);
}
