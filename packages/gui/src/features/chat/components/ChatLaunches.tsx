import {
	ActionIcon,
	Box,
	Group,
	Stack,
	Text,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { ArrowClockwiseIcon, PlayIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
	type useLaunches,
	useLaunchLogs,
} from "#client/features/launch/hooks/useLaunches.ts";
import type { zLaunch } from "#core/features/data/types/user.ts";
import type { zLaunchStatus } from "#core/features/tool/types/launch.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";
import Code from "#gui/features/code/components/Code.tsx";

type Launches = ReturnType<typeof useLaunches>;

/** A clock for uptimes, ticking while something is running. */
const useNow = (ticking: boolean) => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!ticking) return;
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [ticking]);
	return now;
};

const COLORS: Record<zLaunchStatus["state"], string> = {
	running: "var(--mantine-color-green-6)",
	stopping: "var(--mantine-color-yellow-6)",
	stopped: "var(--mantine-color-gray-5)",
	exited: "var(--mantine-color-red-6)",
};

function StatusDot({ status }: { status: zLaunchStatus }) {
	const color =
		status.state === "exited" && status.code === 0 && !status.signal
			? COLORS.stopped
			: COLORS[status.state];
	return (
		<Box
			aria-label={LaunchUtils.label(status)}
			w={8}
			h={8}
			style={{ borderRadius: "50%", backgroundColor: color, flexShrink: 0 }}
		/>
	);
}

/** Start or stop, and restart: the same controls as the `launch` tool's. */
export function LaunchControls({
	launch,
	launches,
}: {
	launch: zLaunch;
	launches: Launches;
}) {
	const status = launches.statusOf(launch);
	const active = LaunchUtils.isActive(status.state);
	const pending = launches.isPending(launch) || status.state === "stopping";
	const run = (action: "start" | "stop" | "restart") =>
		launches.control.mutate({ launch, action });
	return (
		<Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
			<Tooltip label={active ? "Stop" : "Start"}>
				<ActionIcon
					variant="subtle"
					size="sm"
					color="gray"
					aria-label={`${active ? "Stop" : "Start"} ${launch.name}`}
					loading={pending && launches.control.variables?.action !== "restart"}
					disabled={pending}
					onClick={() => run(active ? "stop" : "start")}
				>
					{active ? <StopIcon size={14} /> : <PlayIcon size={14} />}
				</ActionIcon>
			</Tooltip>
			<Tooltip label="Restart">
				<ActionIcon
					variant="subtle"
					size="sm"
					color="gray"
					aria-label={`Restart ${launch.name}`}
					loading={pending && launches.control.variables?.action === "restart"}
					disabled={pending || !active}
					onClick={() => run("restart")}
				>
					<ArrowClockwiseIcon size={14} />
				</ActionIcon>
			</Tooltip>
		</Group>
	);
}

/**
 * The project's launches, each with how it is doing on this device. Picking
 * one previews it, with its output.
 */
export function LaunchList({
	launches,
	selected,
	onSelect,
}: {
	launches: Launches;
	selected?: string;
	onSelect: (launch: zLaunch) => void;
}) {
	const now = useNow(
		launches.launches.some((launch) =>
			LaunchUtils.isActive(launches.statusOf(launch).state),
		),
	);
	return (
		<Stack gap={4}>
			{launches.launches.map((launch) => {
				const status = launches.statusOf(launch);
				const details = LaunchUtils.details(status, now);
				return (
					<Group
						key={launch.id}
						gap={4}
						wrap="nowrap"
						px={4}
						style={{
							borderRadius: "var(--mantine-radius-sm)",
							backgroundColor:
								selected === launch.id
									? "var(--mantine-color-default-hover)"
									: undefined,
						}}
					>
						<UnstyledButton
							flex={1}
							miw={0}
							py={4}
							onClick={() => onSelect(launch)}
						>
							<Group gap={8} wrap="nowrap">
								{launches.supported && <StatusDot status={status} />}
								<Stack gap={0} miw={0} flex={1}>
									<Text size="sm" truncate title={launch.script}>
										{launch.name}
									</Text>
									{details.length > 0 && (
										<Text size="xs" c="dimmed" truncate>
											{details.join(" · ")}
										</Text>
									)}
								</Stack>
							</Group>
						</UnstyledButton>
						{launches.supported && (
							<LaunchControls launch={launch} launches={launches} />
						)}
					</Group>
				);
			})}
			{!launches.supported && (
				<Text size="xs" c="dimmed">
					Launches run in the desktop app and CLI
				</Text>
			)}
		</Stack>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<Group gap="xs" wrap="nowrap">
			<Text size="xs" c="dimmed" fw={600} w={64} style={{ flexShrink: 0 }}>
				{label}
			</Text>
			<Text size="xs" ff="monospace" truncate>
				{value}
			</Text>
		</Group>
	);
}

/** One launch: its script, how it is doing, and what it has printed. */
export function LaunchPreview({
	launch,
	launches,
}: {
	launch: zLaunch;
	launches: Launches;
}) {
	const status = launches.statusOf(launch);
	const active = LaunchUtils.isActive(status.state);
	const now = useNow(active);
	const logs = useLaunchLogs({ launch: launches.supported ? launch : null });
	const exit = LaunchUtils.exit(status);
	return (
		<Stack h="100%" gap="xs">
			<Stack
				gap={4}
				p="xs"
				bg="var(--tc-surface)"
				style={{ borderRadius: "var(--mantine-radius-md)" }}
			>
				<Group gap="xs" wrap="nowrap">
					{launches.supported && <StatusDot status={status} />}
					<Text size="sm" fw={600} flex={1} truncate>
						{launch.name}
					</Text>
					{launches.supported && (
						<LaunchControls launch={launch} launches={launches} />
					)}
				</Group>
				<Field label="Script" value={launch.script} />
				{launches.supported && (
					<>
						<Field label="Status" value={LaunchUtils.label(status)} />
						{active && (
							<>
								<Field label="PID" value={String(status.pid ?? "—")} />
								<Field
									label="Uptime"
									value={LaunchUtils.uptime(status, now) ?? "—"}
								/>
								<Field
									label="Ports"
									value={
										status.ports.map((port) => `:${port}`).join(" ") || "none"
									}
								/>
								<Field
									label="CPU"
									value={
										status.cpu !== null
											? LaunchUtils.formatCpu(status.cpu)
											: "—"
									}
								/>
								<Field
									label="Memory"
									value={
										status.memory !== null
											? `${LaunchUtils.formatBytes(status.memory)} (${status.processes} ${status.processes === 1 ? "process" : "processes"})`
											: "—"
									}
								/>
							</>
						)}
						{!active && exit && <Field label="Exit" value={exit} />}
					</>
				)}
			</Stack>
			{launches.supported && (
				<Box flex={1} mih={0}>
					<Code
						code={logs.data || "No output yet"}
						filename={`${launch.name}.log`}
						lineNumbers={false}
						streaming={active}
						maw="100%"
						h="100%"
						fillHeight
					/>
				</Box>
			)}
		</Stack>
	);
}
