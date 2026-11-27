import { Pressable, type PressableProps, Text } from "better-ink-ui";
import { useEffect, useRef, useState } from "react";

/**
 * A bracketed text button, dimmed while hovered.
 *
 * `labelOnClick` stands in for `label` for a moment after a click, to confirm
 * an action that has nothing else to show for itself (a copy, say). A
 * disabled one is drawn dimmed, and neither hovers nor clicks.
 */
export default function Button({
	label,
	labelOnClick,
	onClick,
	timeout = 2000,
	disabled = false,
	...props
}: Omit<PressableProps, "children" | "onPress"> & {
	label: string;
	labelOnClick?: string;
	onClick?: () => unknown;
	timeout?: number;
	disabled?: boolean;
}) {
	const [clicked, setClicked] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(timeoutRef.current), []);

	return (
		<Pressable
			disabled={disabled}
			{...props}
			onPress={() => {
				onClick?.();
				if (labelOnClick) {
					setClicked(true);
					clearTimeout(timeoutRef.current);
					timeoutRef.current = setTimeout(() => setClicked(false), timeout);
				}
				// On to the panel it is in, which takes the focus — unless this
				// press already moved it, opening a page, say.
				return false;
			}}
		>
			{({ isHovered }) => (
				<Text
					color="text"
					backgroundColor={disabled || isHovered ? "borderSubtle" : "border"}
					dimColor={disabled}
				>
					{` `}
					{clicked && labelOnClick ? labelOnClick : label}
					{` `}
				</Text>
			)}
		</Pressable>
	);
}
