import type { Client } from "#client/client.ts";
import type { ClientLaunch } from "#client/features/launch/types/launch.ts";
import type { LaunchCapability } from "#core/core/types/capability.ts";
import type { zLaunch } from "#core/features/data/types/user.ts";

export const LaunchService = {
	/**
	 * The host's launches as a project's are run: each in the folder the shell
	 * starts in for the open chat (its project's first folder on this device),
	 * or where the runtime itself was started when it has none. The UI and the
	 * tool both go through here, so a launch runs in the same place whichever
	 * starts it.
	 */
	create: ({
		client,
		launch: host,
	}: {
		client: Client;
		launch: ClientLaunch;
	}): LaunchCapability => {
		const cwd = async () =>
			(await client.workingDirectory.folders())[0] ??
			(await client.workingDirectory.origin()) ??
			undefined;

		const toProcess = async (launch: zLaunch) => ({
			id: launch.id,
			script: launch.script,
			cwd: await cwd(),
		});

		return {
			status: ({ launches }) =>
				host.status({ ids: launches.map((launch) => launch.id) }),
			start: async ({ launch }) => host.start(await toProcess(launch)),
			restart: async ({ launch }) => host.restart(await toProcess(launch)),
			stop: ({ launch, signal, timeout }) =>
				host.stop({ id: launch.id, signal, timeout }),
			signal: ({ launch, signal }) => host.signal({ id: launch.id, signal }),
			logs: ({ launch, lines }) => host.logs({ id: launch.id, lines }),
		};
	},
} as const;
