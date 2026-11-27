import type { Client } from "#client/client.ts";
import { LaunchService } from "#client/features/launch/services/LaunchService.ts";
import type {
	CapabilityFactory,
	LaunchCapability,
} from "#core/core/types/capability.ts";

/** The host's launches, whose processes outlive a message. */
export const createLaunchCapability: CapabilityFactory<
	{ client: Client },
	LaunchCapability
> = async ({ client }) => {
	if (!client.launch) throw new Error("missing client launch");
	return LaunchService.create({ client, launch: client.launch });
};
