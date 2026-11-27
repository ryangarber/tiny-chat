import type {
	zLaunchProcess,
	zLaunchSignal,
	zLaunchStatus,
} from "#core/features/tool/types/launch.ts";

/**
 * Launches as a host runs them, by id: the CLI holds them itself
 * (`LaunchHostService`), and the desktop app's main process holds them for its
 * webview, which reaches them over RPC (`LaunchRemoteService`). Processes
 * belong to the host, so they outlive the chats and windows that start them.
 */
export interface ClientLaunch {
	status: (_: { ids: string[] }) => Promise<zLaunchStatus[]>;
	start: (_: zLaunchProcess) => Promise<zLaunchStatus>;
	restart: (_: zLaunchProcess) => Promise<zLaunchStatus>;
	stop: (_: {
		id: string;
		signal?: zLaunchSignal;
		timeout?: number;
	}) => Promise<zLaunchStatus>;
	signal: (_: { id: string; signal: zLaunchSignal }) => Promise<zLaunchStatus>;
	logs: (_: { id: string; lines?: number }) => Promise<string>;
}

/** What a host carries for a remote caller: one method, with its argument. */
export interface LaunchRequest {
	method: keyof ClientLaunch;
	input: unknown;
}

export const LAUNCH_METHODS = [
	"status",
	"start",
	"restart",
	"stop",
	"signal",
	"logs",
] as const satisfies readonly (keyof ClientLaunch)[];
