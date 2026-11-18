import {
	ClipboardProvider,
	ImageProvider,
	type ImageProviderProps,
	Text,
	type Theme,
	ThemeProvider,
} from "better-ink-ui";
import { Box, useApp, useInput } from "ink";
import { type ReactNode, useContext, useMemo } from "react";
import ErrorBoundary, {
	type ErrorFallbackProps,
} from "#client/core/components/ErrorBoundary.tsx";
import ThemeContextProvider, {
	ThemeContext,
} from "#client/core/components/ThemeContext.tsx";
import App from "#tui/core/components/App.tsx";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";

/**
 * Hands the app's color scheme to `better-ink-ui`, so its components take the
 * scheme's names (`primary`, `borderSubtle`, …) and blend translucent colors
 * over the surface.
 */
function UiTheme({ children }: { children: ReactNode }) {
	const { colorScheme } = useContext(ThemeContext);
	const theme = useMemo<Partial<Theme>>(
		() => ({
			colors: {
				...colorScheme,
				scrollbar: "borderSubtle",
				scrollbarActive: "border",
			},
			background: colorScheme.surface,
		}),
		[colorScheme],
	);
	return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

/**
 * In place of an app that failed to draw. The app's own keys went with it,
 * so this one takes them: retry, or quit.
 */
function AppFallback({ error, reset }: ErrorFallbackProps) {
	const { exit } = useApp();
	useInput((input, key) => {
		if (input === "r") reset();
		else if (input === "q" || (key.ctrl && (input === "c" || input === "d")))
			exit();
	});
	return (
		<Box flexDirection="column" padding={1} gap={1}>
			<Text color="red">⚠ Something went wrong: {error.message}</Text>
			<Text dimColor>r retry · q quit</Text>
		</Box>
	);
}

/**
 * The whole terminal UI, for a host to render inside its own
 * `QueryClientProvider` and `ClientContext`. A host passes `images` with the
 * terminal's capabilities, detected before Ink takes stdin, and how to start
 * the image worker when it bundles one; without them the terminal is guessed
 * from its environment.
 */
export default function Root({
	images,
}: {
	images?: Omit<ImageProviderProps, "children">;
}) {
	return (
		<ThemeContextProvider>
			<UiTheme>
				{/* Below the app's own, for a failure in the app itself: past this,
			    Ink unmounts everything. */}
				<ErrorBoundary label="the app" fallback={AppFallback}>
					{/* The system clipboard, where OSC 52 would need the terminal's
				    permission — or tmux's `set-clipboard` — to reach it. */}
					<ClipboardProvider copy={ClipboardService.copy}>
						<ImageProvider {...images}>
							<App />
						</ImageProvider>
					</ClipboardProvider>
				</ErrorBoundary>
			</UiTheme>
		</ThemeContextProvider>
	);
}
