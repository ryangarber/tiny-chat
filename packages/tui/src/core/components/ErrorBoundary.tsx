import type { ReactNode } from "react";
import SharedErrorBoundary from "#client/core/components/ErrorBoundary.tsx";
import Text from "#tui/core/components/Text.tsx";

type ErrorBoundaryProps = {
	/** What failed to draw, as the note in its place calls it. */
	label?: string;
	/** Drawing is tried again whenever this changes, as when content streams on. */
	resetKey?: unknown;
	children?: ReactNode;
};

/**
 * Keeps one piece of the UI that fails to draw from taking the app down with
 * it. Ink unmounts everything over an error that reaches its root — with the
 * alternate screen, the whole app simply vanishes — so a failure leaves a
 * one-line note in its place instead.
 */
export default function ErrorBoundary({
	label,
	resetKey,
	children,
}: ErrorBoundaryProps) {
	return (
		<SharedErrorBoundary
			label={label}
			resetKey={resetKey}
			fallback={({ error }) => (
				<Text color="red" wrap="truncate-end">
					⚠ Couldn’t draw {label ?? "this"}: {error.message}
				</Text>
			)}
		>
			{children}
		</SharedErrorBoundary>
	);
}
