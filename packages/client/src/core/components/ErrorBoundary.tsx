import { Component, type ErrorInfo, type ReactNode } from "react";

export type ErrorFallbackProps = {
	error: Error;
	/** What failed to draw, as the note in its place calls it. */
	label?: string;
	/** Draws the children again, for a failure that may not repeat. */
	reset: () => void;
};

type ErrorBoundaryProps = {
	/** What failed to draw, as the note in its place calls it. */
	label?: string;
	/** Drawing is tried again whenever this changes, as when content streams on. */
	resetKey?: unknown;
	/** What is drawn in place of the children once they have failed. */
	fallback: (props: ErrorFallbackProps) => ReactNode;
	children?: ReactNode;
};

type ErrorBoundaryState = { error: Error | null; resetKey: unknown };

/**
 * Keeps one piece of the UI that fails to draw from taking the app down with
 * it: React unmounts everything over an error that reaches its root, which in
 * the terminal leaves nothing on screen and in the app a blank page. Content
 * that comes from outside (markdown, tool output, sources) is drawn inside one
 * of these, and a failure there leaves the renderer's fallback in its place.
 *
 * The failure is logged once, here, with its label, so it can be found in
 * `/console`.
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

	reset = () => this.setState({ error: null });

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;
		return this.props.fallback({
			error,
			label: this.props.label,
			reset: this.reset,
		});
	}
}
