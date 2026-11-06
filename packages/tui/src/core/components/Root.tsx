import { ImageProvider, type ImageProviderProps } from "better-ink-picture";
import ThemeContextProvider from "#client/core/components/ThemeContext.tsx";
import App from "#tui/core/components/App.tsx";

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
			<ImageProvider {...images}>
				<App />
			</ImageProvider>
		</ThemeContextProvider>
	);
}
