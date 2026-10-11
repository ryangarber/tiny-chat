import { createContext, createElement, type ReactNode, useMemo } from "react";
import { useThemes } from "#client/features/settings/hooks/useThemes.ts";
import type { ThemeUtils } from "#core/core/utils/ThemeUtils.ts";

export type ColorPalette = [
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
];

export type ColorScheme = {
	surface: string;
	interior: string;
	exterior: string;
	border: string;
	borderSubtle: string;
	text: string;
	textSubtle: string;
	primary: string;
};

export const palettes: Record<
	(typeof ThemeUtils.themes)[number],
	ColorPalette
> = {
	dark: [
		"#C4C6CF", // [0]  text
		"#A2A4AD", // [1]
		"#858790", // [2]  textSubtle
		"#636570", // [3]
		"#35373e", // [4]  border
		"#202020", // [5]  interior / borderSubtle
		"#161616", // [6]  surface
		"#131317", // [7]  exterior
		"#1e2027", // [8]
		"#141418", // [9]
	],
	light: [
		"#1a1b22", // [0]  text
		"#35373e", // [1]
		"#636570", // [2]  textSubtle
		"#858790", // [3]
		"#A2A4AD", // [4]  border
		"#C4C6CF", // [5]  exterior / borderSubtle
		"#E8E9F0", // [6]  surface
		"#F5F5F5", // [7]  interior
		"#FAFAFA", // [8]
		"#FFFFFF", // [9]
	],
} as const;

export interface ThemeContext {
	colorPalette: ColorPalette;
	colorScheme: ColorScheme;
}

export function buildTheme(
	theme: (typeof ThemeUtils.themes)[number],
): ThemeContext {
	return {
		colorPalette: palettes[theme],
		colorScheme: {
			primary: "#1194ff",
			text: palettes[theme][0],
			textSubtle: palettes[theme][2],
			border: palettes[theme][4],
			borderSubtle: palettes[theme][5],
			interior: palettes[theme][theme === "dark" ? 5 : 7],
			surface: palettes[theme][6],
			exterior: palettes[theme][theme === "dark" ? 7 : 5],
		},
	};
}

export const ThemeContext = createContext<ThemeContext>(buildTheme("dark"));

export default function ThemeContextProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { theme } = useThemes();

	// Rebuilding this per render would hand every consumer a value it has to
	// treat as new. In the CLI that is every Box and Text on screen, none of
	// which a memo can hold back, since context reaches through one.
	const value = useMemo(() => buildTheme(theme), [theme]);

	return createElement(ThemeContext, { value }, children);
}
