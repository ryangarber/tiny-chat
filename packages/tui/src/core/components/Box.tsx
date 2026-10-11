import { Box as _Box, type BoxProps as _BoxProps, type DOMElement } from "ink";
import {
	createContext,
	type ReactNode,
	type RefAttributes,
	useContext,
	useMemo,
} from "react";
import { TextContext } from "#tui/core/components/Text.tsx";
import { type Color, useColor } from "#tui/core/hooks/useColor.ts";

export interface BoxProps
	extends Omit<
		_BoxProps & TextContext,
		"backgroundColor" | "borderColor" | "borderBackgroundColor"
	> {
	backgroundColor?: Color;
	borderColor?: Color;
	borderBackgroundColor?: Color;
	border?: boolean;
}

export interface BoxContext
	extends Pick<
		BoxProps,
		"backgroundColor" | "borderColor" | "borderBackgroundColor"
	> {}
export const BoxContext = createContext<BoxContext | undefined>(undefined);

export default function Box({
	color,
	dimColor,
	wrap,
	backgroundColor: _backgroundColor,
	borderColor: _borderColor,
	borderBackgroundColor: _borderBackgroundColor,
	border: _border,
	...props
}: BoxProps & { children?: ReactNode } & RefAttributes<DOMElement>) {
	const context = useContext(BoxContext);
	const textContext = useContext(TextContext);

	const mergedContext = useMemo<BoxContext>(
		() => ({
			backgroundColor: _backgroundColor ?? context?.backgroundColor,
			borderColor: _borderColor ?? context?.borderColor,
			borderBackgroundColor:
				_borderBackgroundColor ?? context?.borderBackgroundColor,
		}),
		[
			_backgroundColor,
			context?.backgroundColor,
			_borderColor,
			context?.borderColor,
			_borderBackgroundColor,
			context?.borderBackgroundColor,
		],
	);

	// On the inherited values, not the inherited object, so the same object is
	// handed down for as long as the styling holds — see Text.
	const mergedTextContext = useMemo<TextContext>(
		() => ({
			color: color ?? textContext?.color,
			dimColor: dimColor ?? textContext?.dimColor,
			wrap: wrap ?? textContext?.wrap,
		}),
		[
			color,
			textContext?.color,
			dimColor,
			textContext?.dimColor,
			wrap,
			textContext?.wrap,
		],
	);

	const backgroundColor = useColor(mergedContext.backgroundColor);
	const borderColor = useColor(mergedContext.borderColor ?? "border");
	const borderBackgroundColor = useColor(
		mergedContext.borderBackgroundColor ?? mergedContext.backgroundColor,
	);

	const borderProps = useMemo<_BoxProps>(() => {
		return {
			borderLeft: !!_border,
			borderRight: !!_border,
			borderTop: !!_border,
			borderBottom: !!_border,
		};
	}, [_border]);

	return (
		<BoxContext value={mergedContext}>
			<TextContext value={mergedTextContext}>
				<_Box
					backgroundColor={backgroundColor}
					borderColor={borderColor}
					borderBackgroundColor={borderBackgroundColor}
					{...borderProps}
					{...props}
				/>
			</TextContext>
		</BoxContext>
	);
}
