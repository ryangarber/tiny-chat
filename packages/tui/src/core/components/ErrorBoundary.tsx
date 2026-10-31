import { Component, type ErrorInfo, type ReactNode } from "react";
import Text from "#tui/core/components/Text.tsx";

type ErrorBoundaryProps = {
	/** What failed to draw, as the note in its place calls it. */
	label?: string;
	/** Drawing is tried again whenever this changes, as when content streams on. */
	resetKey?: unknown;
	children?: ReactNode;
};

type ErrorBoundaryState = { error: Error | null; resetKey: unknown };

/**
 * Keeps one piece of the UI that fails to draw from taking the app down with
 * it. Ink unmounts everything over an error that reaches its root — with the
 * alternate screen, the whole app simply vanishes — so content that comes
 * from outside (markdown, tool output, sources) is drawn inside one of these,
 * and a failure there leaves a note in its place instead.
 */
export default class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

	static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
		return {
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}

	static getDerivedStateFromProps(
		props: ErrorBoundaryProps,
		state: ErrorBoundaryState,
	): Partial<ErrorBoundaryState> | null {
		if (Object.is(props.resetKey, state.resetKey)) return null;
		return { error: null, resetKey: props.resetKey };
	}

	componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error(
			`[ErrorBoundary] failed to draw ${this.props.label ?? "content"}`,
			error,
			info.componentStack,
		);
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<Text color="red" wrap="truncate-end">
				⚠ Couldn’t draw {this.props.label ?? "this"}: {error.message}
			</Text>
		);
	}
}
