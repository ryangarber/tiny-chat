import CliBoxes, { type Boxes } from "cli-boxes";
import { useContext, useMemo } from "react";
import {
	type ColorScheme,
	ThemeContext,
} from "#client/core/components/ThemeContext.tsx";
import { type ColorString, getColor } from "#tui/core/hooks/useColor.ts";

/** @lintignore */
export type BorderString = ColorString | keyof Boxes | "none" | string;
export type BorderObject = { color?: ColorString; style?: keyof Boxes };
export type Border = BorderString | BorderObject;

/**
 * Parses a border string, approximating transparency based on the theme.
 */
const getBorder = (
	border: Border | undefined,
	colorScheme: ColorScheme,
): BorderObject | null | undefined => {
	let color: ColorString | undefined;
	let style: keyof Boxes | undefined;

	if (border === undefined) return undefined;

	// skip heavy border parsing for valid types
	if (border === null || border === "none") return null;
	if (typeof border === "object") return border;

	// strictly parse border string
	const parts = border
		.split(" ")
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length < 1 || parts.length > 2) {
		throw new Error("invalid border string");
	}

	// find a style or try parsing as color
	for (const part of parts) {
		if (part in CliBoxes) style = part as keyof typeof CliBoxes;
		else color = getColor(color, colorScheme);
	}

	return { color, style };
};

export const useBorder = (border?: Border) => {
	const { colorScheme } = useContext(ThemeContext);
	return useMemo(() => getBorder(border, colorScheme), [border, colorScheme]);
};
