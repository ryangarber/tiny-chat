import { ImageProvider, type ImageProviderProps } from "better-ink-picture";
import { Box, useApp, useInput } from "ink";
import ErrorBoundary, {
	type ErrorFallbackProps,
} from "#client/core/components/ErrorBoundary.tsx";
import ThemeContextProvider from "#client/core/components/ThemeContext.tsx";
import App from "#tui/core/components/App.tsx";
import Text from "#tui/core/components/Text.tsx";

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
			{/* Below the app's own, for a failure in the app itself: past this,
			    Ink unmounts everything. */}
			<ErrorBoundary label="the app" fallback={AppFallback}>
				<ImageProvider {...images}>
					<App />
				</ImageProvider>
			</ErrorBoundary>
		</ThemeContextProvider>
	);
}
