import type {
	BrowserStatus,
	ComputerStatus,
	InstallProgress,
	InstallResult,
	Permission,
	Requirement,
	TerminalStatus,
} from "computah/schema";
import type { ComputahSurface } from "#client/features/agent/types/computah.ts";

/** One thing a surface needs, found or not. */
export interface SurfaceRequirement {
	key: string;
	label: string;
	found: boolean;
	/** Missing it only limits what can be done, so it warns rather than fails. */
	optional?: boolean;
	detail: string;
}

/** An OS grant, and who it is asked of. */
export interface SurfacePermission {
	key: string;
	name: string;
	label: string;
	granted: boolean;
	owner: "host" | "app";
	/** Whether the OS will prompt for it; otherwise its settings pane is opened. */
	promptable: boolean;
}

/**
 * A surface's status as both UIs show it: what it needs and whether it has
 * it, the grants it is missing, and what `install` would add.
 */
export interface SurfaceReport {
	available: boolean;
	error?: string;
	requirements: SurfaceRequirement[];
	permissions: SurfacePermission[];
	/** What `install` would add, where something it can add is missing. */
	install?: string;
	/** Worth saying beside the rest, as how a new grant takes effect. */
	note?: string;
}

const PERMISSION_LABELS: Record<string, string> = {
	accessibility: "Accessibility",
	"screen-recording": "Screen recording",
};

const describe = ({ version, path, source }: Requirement) =>
	[version, source, path].filter(Boolean).join(" · ");

const requirement = (
	key: string,
	label: string,
	found: Requirement,
	missing: string,
	optional?: boolean,
): SurfaceRequirement => ({
	key,
	label,
	found: found.found,
	...(optional ? { optional } : {}),
	detail: found.found ? describe(found) || found.name : missing,
});

/**
 * The host's own grants are named plainly, since whose they are depends on
 * the runtime (the app, or the terminal a CLI runs in); a helper app's say
 * whose they are.
 */
const permissions = (all: Permission[], app: string): SurfacePermission[] =>
	all.map((permission) => {
		const owner = permission.owner === "app" ? "app" : "host";
		const label = PERMISSION_LABELS[permission.name] ?? permission.name;
		return {
			key: `${owner}:${permission.name}`,
			name: permission.name,
			label: owner === "app" ? `${label} · ${app}` : label,
			granted: permission.granted,
			owner,
			promptable: permission.promptable !== false,
		};
	});

const browser = (status: BrowserStatus): SurfaceReport => {
	const inUse = status.browser ?? status.browsers[0];
	const others = status.browsers.length - (inUse ? 1 : 0);
	const missing = [
		!status.playwright.found && status.playwright.installable !== false
			? "Playwright"
			: "",
		inUse ? "" : "Chromium",
	].filter(Boolean);
	return {
		available: status.available,
		...(status.error ? { error: status.error } : {}),
		requirements: [
			requirement(
				"runtime",
				"Node.js",
				status.runtime,
				"not found · install Node.js to drive a browser",
			),
			requirement(
				"playwright",
				"Playwright",
				status.playwright,
				"not found · can be installed",
			),
			{
				key: "browser",
				label: "Browser",
				found: !!inUse,
				detail: inUse
					? [
							[inUse.name, inUse.version].filter(Boolean).join(" "),
							inUse.source,
							inUse.path,
							others ? `${others} more found` : "",
						]
							.filter(Boolean)
							.join(" · ")
					: "not found · Chromium can be installed",
			},
			{
				key: "display",
				label: "Browser window",
				found: status.display.available,
				optional: true,
				detail: status.display.available
					? "can be shown on this desktop"
					: `${status.display.error ?? "no desktop to show it on"} · runs headless instead`,
			},
		],
		permissions: permissions(status.permissions, "browser"),
		...(missing.length ? { install: missing.join(" and ") } : {}),
	};
};

const terminal = (status: TerminalStatus): SurfaceReport => ({
	available: status.available,
	...(status.error ? { error: status.error } : {}),
	requirements: [
		requirement(
			"tmux",
			"tmux",
			status.tmux,
			status.tmux.installable ? "not found · can be installed" : "not found",
		),
	],
	permissions: permissions(status.permissions, "tmux"),
	...(!status.tmux.found && status.tmux.installable ? { install: "tmux" } : {}),
});

const MODES: Record<NonNullable<ComputerStatus["mode"]>, string> = {
	app: "the Cua Driver app, under its own permissions",
	embedded: "Cua Driver, run by this app under its permissions",
	"in-process": "inside this app, without a virtual cursor",
	external: "a driver started elsewhere",
};

const CURSOR_REASONS: Record<
	NonNullable<ComputerStatus["cursor"]["reason"]>,
	string
> = {
	disabled: "turned off",
	"not-installed": "needs Cua Driver, which can be installed",
	"not-running": "Cua Driver could not be started",
	permissions: "Cua Driver is missing permissions",
	unsupported: "not supported here",
};

const computer = (status: ComputerStatus): SurfaceReport => {
	const macos = status.os === "darwin";
	const missing = status.permissions.some(
		(permission) => permission.owner === "host" && !permission.granted,
	);
	return {
		available: status.available,
		...(status.error ? { error: status.error } : {}),
		requirements: [
			requirement(
				"sdk",
				"Driver library",
				status.sdk,
				"cannot be loaded on this machine",
			),
			requirement(
				"app",
				"Cua Driver",
				status.app,
				"not installed · draws the on-screen cursor",
				true,
			),
			...(status.mode
				? [
						{
							key: "mode",
							label: "Driver",
							found: true,
							detail: MODES[status.mode],
						},
					]
				: []),
			{
				key: "cursor",
				label: "On-screen cursor",
				found: status.cursor.available,
				optional: true,
				detail: status.cursor.available
					? "shown while the agent works"
					: status.cursor.reason
						? CURSOR_REASONS[status.cursor.reason]
						: "unavailable",
			},
		],
		permissions: permissions(status.permissions, "Cua Driver"),
		...(!status.app.found && status.app.installable !== false
			? { install: "Cua Driver" }
			: {}),
		...(macos && missing
			? {
					note: "macOS applies a new grant once the app (or the terminal running it) restarts.",
				}
			: {}),
	};
};

export const SurfaceUtils = {
	/** A surface's status, as both UIs show it. */
	report: (
		surface: ComputahSurface,
		status: BrowserStatus | TerminalStatus | ComputerStatus,
	): SurfaceReport =>
		surface === "browser"
			? browser(status as BrowserStatus)
			: surface === "terminal"
				? terminal(status as TerminalStatus)
				: computer(status as ComputerStatus),

	/** For a runtime that holds no surfaces, as the web does. */
	unavailable: (): SurfaceReport => ({
		available: false,
		error: "Needs the desktop app or the CLI.",
		requirements: [],
		permissions: [],
	}),

	/** A failed status, which says why rather than throwing. */
	failed: (error: unknown): SurfaceReport => ({
		available: false,
		error: error instanceof Error ? error.message : String(error),
		requirements: [],
		permissions: [],
	}),

	/** `Downloading Chromium · 42%` */
	progress: ({ message, received, total }: InstallProgress) =>
		received !== undefined && total
			? `${message} · ${Math.round((received / total) * 100)}%`
			: message,

	/** What to say after an install, when there is more to say than it worked. */
	installed: (result: InstallResult) =>
		result.ok
			? undefined
			: [
					result.error ?? "The install did not finish.",
					result.command ? `Run it yourself: ${result.command}` : "",
				]
					.filter(Boolean)
					.join(" "),
} as const;
