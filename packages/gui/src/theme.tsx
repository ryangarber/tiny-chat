import {
	type CSSVariablesResolver,
	createTheme,
	type MantineThemeOverride,
} from "@mantine/core";
import { buildTheme, palettes } from "#client/core/components/ThemeContext.tsx";

export default createTheme({
	fontFamily: "'Rubik', sans-serif",
	primaryColor: "blue",
	lineHeights: {
		md: "1.8",
	},
	defaultRadius: "lg",
	colors: palettes,
	components: {
		AppShell: {
			classNames: {
				header: "glass",
				navbar: "glass",
				aside: "glass",
				footer: "glass",
			},
		},
		Paper: {
			defaultProps: {
				radius: "lg",
			},
			classNames: {
				root: "glass",
			},
		},
		Modal: {
			defaultProps: {
				radius: "lg",
			},
			classNames: {
				content: "glass",
				header: "mb-lg bg-transparent",
			},
		},
		Drawer: {
			classNames: {
				content: "glass",
				header: "mb-lg bg-transparent",
			},
		},
		Dialog: {
			defaultProps: {
				radius: "lg",
			},
			classNames: {
				root: "glass",
			},
		},
		Popover: {
			defaultProps: {
				radius: "lg",
				transitionProps: {
					transition: "fade-up",
				},
			},
			classNames: {
				dropdown: "glass",
			},
		},
		Menu: {
			defaultProps: {
				radius: "lg",
			},
			classNames: {
				dropdown: "glass",
			},
		},
		Combobox: {
			classNames: {
				dropdown: "glass",
			},
			defaultProps: {
				transitionProps: {
					transition: "fade-up",
				},
			},
		},
		Select: {
			classNames: {
				dropdown: "glass",
			},
		},
		TreeSelect: {
			classNames: {
				dropdown: "glass",
			},
		},
		NavLink: {
			defaultProps: {
				bdrs: "lg",
			},
		},
		Tooltip: {
			defaultProps: {
				radius: "lg",
				position: "bottom",
				c: "var(--mantine-color-dimmed)",
			},
			classNames: {
				tooltip: "glass",
			},
		},
		Tabs: {
			defaultProps: {
				radius: "lg",
			},
		},
		Spotlight: {
			defaultProps: {
				radius: "lg",
			},
			classNames: {
				content: "glass",
			},
		},
		Card: {
			defaultProps: {
				radius: "lg",
			},
			classNames: {
				root: "glass", // TODO - card or root?
			},
			styles: {
				root: {
					background: "transparent",
				},
			},
		},
		CheckboxCard: {
			classNames: {
				card: "glass",
			},
			styles: {
				card: {
					background: "transparent",
				},
			},
		},
		Input: {
			classNames: {
				input: "glass",
			},
			styles: {
				input: {
					background: "transparent",
				},
			},
		},
	},
} satisfies MantineThemeOverride);

export const cssResolver: CSSVariablesResolver = () => ({
	variables: {
		"--mantine-color-body": "var(--tc-surface)",
	},
	light: {
		"--tc-exterior": buildTheme("light").colorScheme.exterior,
		"--tc-surface": buildTheme("light").colorScheme.surface,
		"--tc-interior": buildTheme("light").colorScheme.interior,
		"--tc-highlight": "rgba(0, 0, 0, 0.05)",
		"--tc-shadow": "0 10px 40px rgba(0, 0, 0, 0.2)",
	},
	dark: {
		"--tc-exterior": buildTheme("dark").colorScheme.exterior,
		"--tc-surface": buildTheme("dark").colorScheme.surface,
		"--tc-interior": buildTheme("dark").colorScheme.interior,
		"--tc-highlight": "rgba(255, 255, 255, 0.05)",
		"--tc-shadow": "0 10px 40px rgba(0, 0, 0, 0.2)",
	},
});
