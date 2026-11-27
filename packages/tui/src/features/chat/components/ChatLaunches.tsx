import { Box, Text } from "better-ink-ui";
import { useEffect, useState } from "react";
import {
	type useLaunches,
	useLaunchLogs,
} from "#client/features/launch/hooks/useLaunches.ts";
import type { zLaunch } from "#core/features/data/types/user.ts";
import type { zLaunchStatus } from "#core/features/tool/types/launch.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";
import Content from "#tui/core/components/Content.tsx";

export type Launches = ReturnType<typeof useLaunches>;

/** A clock for uptimes, ticking while something is running. */
export const useNow = (ticking: boolean) => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!ticking) return;
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [ticking]);
	return now;
};

const color = (status: zLaunchStatus) => {
	if (status.state === "running") return "greenBright";
	if (status.state === "stopping") return "yellowBright";
	if (status.state === "exited" && (status.code !== 0 || status.signal))
		return "redBright";
	return "textSubtle";
};

export function StatusDot({ status }: { status: zLaunchStatus }) {
	return <Text color={color(status)}>●</Text>;
}

/** A launch as the sources list it: its name, and how it is doing. */
export function LaunchRow({
	launch,
	launches,
	now,
}: {
	launch: zLaunch;
	launches: Launches;
	now: number;
}) {
	const status = launches.statusOf(launch);
	const details = LaunchUtils.details(status, now);
	const pending = launches.isPending(launch);
	return (
		<Box flexGrow={1} minWidth={0} gap={1}>
			{launches.supported && (
				<Box flexShrink={0}>
					<StatusDot status={status} />
				</Box>
			)}
			<Box flexShrink={1} minWidth={0}>
				<Text wrap="truncate-end">{launch.name}</Text>
			</Box>
			{(details.length > 0 || pending) && (
				<Box flexShrink={1000} minWidth={0}>
					<Text color="textSubtle" wrap="truncate-end">
						{pending ? "…" : details.join(" · ")}
					</Text>
				</Box>
			)}
		</Box>
	);
}

function Line({ label, value }: { label: string; value: string }) {
	return (
		<Text>
			<Text color="textSubtle" bold>
				{label.padEnd(8)}
			</Text>
			{value}
		</Text>
	);
}

/** One launch: its script, how it is doing, and the end of its output. */
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
	const logs = useLaunchLogs({
		launch: launches.supported ? launch : null,
		lines: 200,
	});
	const exit = LaunchUtils.exit(status);
	const output = logs.data?.replace(/\n$/, "") ?? "";
	return (
		<Content formatter={() => output} findLabel={`${launch.name} output`}>
			<Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
				<Box flexDirection="column">
					<Line label="script" value={launch.script} />
					{launches.supported ? (
						<>
							<Text>
								<Text color="textSubtle" bold>
									{"status".padEnd(8)}
								</Text>
								<StatusDot status={status} /> {LaunchUtils.label(status)}
							</Text>
							{active && (
								<>
									<Line label="pid" value={String(status.pid ?? "—")} />
									<Line
										label="uptime"
										value={LaunchUtils.uptime(status, now) ?? "—"}
									/>
									<Line
										label="ports"
										value={
											status.ports.map((port) => `:${port}`).join(" ") || "none"
										}
									/>
									<Line
										label="cpu"
										value={
											status.cpu !== null
												? LaunchUtils.formatCpu(status.cpu)
												: "—"
										}
									/>
									<Line
										label="memory"
										value={
											status.memory !== null
												? `${LaunchUtils.formatBytes(status.memory)} (${status.processes} ${status.processes === 1 ? "process" : "processes"})`
												: "—"
										}
									/>
								</>
							)}
							{!active && exit && <Line label="exit" value={exit} />}
						</>
					) : (
						<Text color="textSubtle">
							Launches run in the desktop app and CLI
						</Text>
					)}
				</Box>
				{launches.supported && (
					<Box flexDirection="column">
						<Text color="textSubtle" bold>
							output
						</Text>
						<Text>{output || "nothing yet"}</Text>
					</Box>
				)}
			</Box>
		</Content>
	);
}
