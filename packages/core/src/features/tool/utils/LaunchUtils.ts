import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zLaunch, zSettings } from "#core/features/data/types/user.ts";
import type {
	zLaunchState,
	zLaunchStatus,
} from "#core/features/tool/types/launch.ts";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** Terminal escape sequences: colors, cursor moves, titles. */
const ANSI_REGEX = new RegExp(
	`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`,
	"g",
);

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export const LaunchUtils = {
	/** A project's launches: only its own, never the user's. */
	of: (project?: { settings?: zSettings | null } | null): zLaunch[] =>
		project?.settings?.launches ?? [],

	/** The launch a name means, matched exactly, then without regard to case. */
	find: ({ launches, name }: { launches: zLaunch[]; name: string }) =>
		launches.find((launch) => launch.name === name) ??
		launches.find(
			(launch) => launch.name.toLowerCase() === name.trim().toLowerCase(),
		),

	/** A status for a launch its host has never run. */
	idle: (id: string): zLaunchStatus => ({
		id,
		state: "stopped",
		pid: null,
		startedAt: null,
		endedAt: null,
		code: null,
		signal: null,
		ports: [],
		cpu: null,
		memory: null,
		processes: 0,
	}),

	isActive: (state?: zLaunchState) =>
		state === "running" || state === "stopping",

	/** A size written short: `950 B`, `12 MB`, `1.2 GB`. */
	formatBytes: (bytes: number) => {
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < UNITS.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
	},

	formatCpu: (cpu: number) =>
		`${cpu >= 10 ? Math.round(cpu) : cpu.toFixed(1)}%`,

	/** How long the current run has gone on, or how long ago the last ended. */
	uptime: (status: zLaunchStatus, now = Date.now()) =>
		LaunchUtils.isActive(status.state) && status.startedAt !== null
			? CommonUtils.formatElapsed(Math.max(0, now - status.startedAt))
			: null,

	/** How the last run ended: `exit 1`, `SIGTERM`. */
	exit: (status: zLaunchStatus) =>
		status.signal
			? status.signal
			: status.code !== null
				? `exit ${status.code}`
				: null,

	/** The state as a word, with how a run that ended on its own ended. */
	label: (status: zLaunchStatus) => {
		if (status.state === "exited") {
			const exit = LaunchUtils.exit(status);
			return status.code === 0 && !status.signal
				? "finished"
				: `crashed${exit ? ` (${exit})` : ""}`;
		}
		return status.state;
	},

	/**
	 * What is worth showing about a run beside its name, each as a short
	 * piece: `3m 12s`, `:3000 :5173`, `2.1% CPU`, `120 MB`.
	 */
	details: (status: zLaunchStatus, now = Date.now()) => {
		if (!LaunchUtils.isActive(status.state)) {
			return status.state === "exited" ? [LaunchUtils.label(status)] : [];
		}
		return [
			LaunchUtils.uptime(status, now),
			status.ports.length
				? status.ports.map((port) => `:${port}`).join(" ")
				: null,
			status.cpu !== null ? `${LaunchUtils.formatCpu(status.cpu)} CPU` : null,
			status.memory !== null ? LaunchUtils.formatBytes(status.memory) : null,
		].filter((piece): piece is string => !!piece);
	},

	/** A status as the model reads it: no ids, times as durations. */
	describe: ({
		launch,
		status,
		now = Date.now(),
	}: {
		launch: zLaunch;
		status: zLaunchStatus;
		now?: number;
	}) => {
		const active = LaunchUtils.isActive(status.state);
		return {
			name: launch.name,
			state: LaunchUtils.label(status),
			...(active && {
				pid: status.pid,
				uptime: LaunchUtils.uptime(status, now),
				ports: status.ports,
				cpu:
					status.cpu !== null ? LaunchUtils.formatCpu(status.cpu) : undefined,
				memory:
					status.memory !== null
						? LaunchUtils.formatBytes(status.memory)
						: undefined,
				processes: status.processes,
			}),
			...(!active &&
				status.endedAt !== null && {
					ended: `${CommonUtils.formatElapsed(Math.max(0, now - status.endedAt))} ago`,
					exit: LaunchUtils.exit(status),
				}),
		};
	},

	/** Output without its colors and cursor movement, as text to read. */
	stripAnsi: (text: string) =>
		text.replace(ANSI_REGEX, "").replace(/\r(?!\n)/g, "\n"),

	/** The last `lines` lines of some output. */
	tail: (text: string, lines: number) => {
		const all = text.replace(/\n$/, "").split("\n");
		return all.slice(Math.max(0, all.length - lines)).join("\n");
	},

	/**
	 * A launch written on one line, as the terminal UI edits it: `name: script`.
	 * A line without a name is named by its script.
	 */
	format: (launch: Pick<zLaunch, "name" | "script">) =>
		launch.name === launch.script
			? launch.script
			: `${launch.name}: ${launch.script}`,

	/** The reverse of `format`: the name is what comes before the first `: `. */
	parse: (text: string): Pick<zLaunch, "name" | "script"> | null => {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const index = trimmed.indexOf(": ");
		if (index <= 0) return { name: trimmed, script: trimmed };
		const name = trimmed.slice(0, index).trim();
		const script = trimmed.slice(index + 2).trim();
		return script ? { name, script } : null;
	},
} as const;
