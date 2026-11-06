import {
	ActionIcon,
	Alert,
	Button,
	Center,
	Code,
	Group,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import SharedErrorBoundary from "#client/core/components/ErrorBoundary.tsx";

type ErrorBoundaryProps = {
	/** What failed to draw, as the note in its place calls it. */
	label?: string;
	/** Drawing is tried again whenever this changes, as when content streams on. */
	resetKey?: unknown;
	children?: ReactNode;
};

/**
 * Keeps one piece of the UI that fails to draw from taking the app down with
 * it. React unmounts everything over an error that reaches its root, leaving a
 * blank page, so a failure leaves a note in its place instead, with a way to
 * try drawing it again.
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
			fallback={({ error, reset }) => (
				<Alert variant="light" color="red" p="xs" role="alert">
					<Group justify="space-between" wrap="nowrap" gap="xs">
						<Group gap="xs" wrap="nowrap" miw={0}>
							<WarningCircleIcon size={18} style={{ flexShrink: 0 }} />
							<Text size="sm" truncate title={error.message}>
								Couldn’t draw {label ?? "this"}: {error.message}
							</Text>
						</Group>
						<Tooltip label="Try again">
							<ActionIcon
								variant="subtle"
								color="red"
								aria-label="Try again"
								onClick={reset}
							>
								<ArrowClockwiseIcon size={18} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Alert>
			)}
		>
			{children}
		</SharedErrorBoundary>
	);
}

/**
 * The last line of defense, around the whole app: whatever no narrower
 * boundary caught is shown here rather than as a blank page, with the error to
 * report and a way back.
 */
export function RootErrorBoundary({ children }: { children?: ReactNode }) {
	return (
		<SharedErrorBoundary
			label="the app"
			fallback={({ error, reset }) => (
				<Center h="100dvh" p="xl">
					<Stack align="center" gap="md" maw={560}>
						<WarningCircleIcon size={40} />
						<Title order={3}>Something went wrong</Title>
						<Text c="dimmed" ta="center">
							Tiny Chat couldn’t draw this screen. Your chats are saved.
						</Text>
						<Code block w="100%" style={{ whiteSpace: "pre-wrap" }}>
							{error.message}
						</Code>
						<Group>
							<Button variant="light" onClick={reset}>
								Try again
							</Button>
							<Button onClick={() => window.location.reload()}>Reload</Button>
						</Group>
					</Stack>
				</Center>
			)}
		>
			{children}
		</SharedErrorBoundary>
	);
}
