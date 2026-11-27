import {
	type ClientLaunch,
	LAUNCH_METHODS,
	type LaunchRequest,
} from "#client/features/launch/types/launch.ts";

export const LaunchRemoteService = {
	/**
	 * Launches for a runtime that cannot run processes, as the desktop app's
	 * webview cannot: every method is carried to the host that does.
	 */
	create: ({
		call,
	}: {
		call: (request: LaunchRequest) => Promise<unknown>;
	}): ClientLaunch =>
		Object.fromEntries(
			LAUNCH_METHODS.map((method) => [
				method,
				(input: unknown) => call({ method, input }),
			]),
		) as unknown as ClientLaunch,

	/** Answers a remote caller's request with the host's own launches. */
	serve:
		({ launch }: { launch: ClientLaunch }) =>
		async ({ method, input }: LaunchRequest) => {
			if (!(LAUNCH_METHODS as readonly string[]).includes(method)) {
				throw new Error(`Unknown launch method: ${method}`);
			}
			const target = launch[method] as (input: unknown) => Promise<unknown>;
			return await target(input);
		},
} as const;
