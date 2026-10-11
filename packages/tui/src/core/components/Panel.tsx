import { useInput } from "ink";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import {
	type Focusable,
	selectFocus,
	selectPage,
	useAppStore,
} from "#tui/core/stores/useAppStore.ts";

/**
 * Whether the panel something is drawn in has the focus. Outside of any panel
 * — on a page, which has the keys to itself — it always does.
 */
const PanelContext = createContext({ focused: true });

export const usePanel = () => useContext(PanelContext);

/** Whether a focusable has the focus, for the one that draws it. */
export const useFocused = (focusable: Focusable) =>
	useAppStore((state) => selectFocus(state) === focusable);

/**
 * Something on the chat page that takes the keys in turn: Tab moves between
 * those on screen, and a press anywhere in one focuses it. What it draws
 * reads whether it is focused through `usePanel`.
 *
 * Visibility is independent of focus; only an explicit close hides a panel.
 */
export default function Panel({
	id,
	title,
	closable = false,
	onClose,
	disabled = false,
	children,
	...props
}: BoxProps & {
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
	const addFocusable = useAppStore((state) => state.addFocusable);
	const removeFocusable = useAppStore((state) => state.removeFocusable);
	const setFocus = useAppStore((state) => state.setFocus);

	useEffect(() => {
		if (disabled) return;
		addFocusable(id);
		return () => removeFocusable(id);
	}, [id, disabled, addFocusable, removeFocusable]);

	const focused = useFocused(id) && !disabled;

	const { mouseRef } = useMouseInput({
		// Not over a page opened by the same press, from something drawn inside.
		onClick: () => {
			if (selectPage(useAppStore.getState()) === "chat") setFocus(id);
		},
		isActive: !disabled,
	});

	useInput(
		(input, key) => {
			if (input === "x" && !key.ctrl && !key.meta) onClose?.();
		},
		{ isActive: focused && closable },
	);

	return (
		<PanelContext.Provider value={{ focused }}>
			<Box
				ref={(element) => mouseRef(element, 0)}
				flexDirection="column"
				{...props}
			>
				{(title !== undefined || closable) && (
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
						{closable && (
							<Button label="×" disabled={disabled} onClick={onClose} />
						)}
					</Box>
				)}
				{children}
			</Box>
		</PanelContext.Provider>
	);
}
