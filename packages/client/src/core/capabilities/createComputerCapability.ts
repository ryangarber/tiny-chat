import type { Client } from "#client/client.ts";
import type {
	CapabilityFactory,
	ComputerCapability,
} from "#core/core/types/capability.ts";

/**
 * The host's own library, as is: it is one object for the life of the client,
 * which is what lets the target window and refs carry over between messages.
 */
export const createComputerCapability: CapabilityFactory<
	{ client: Client },
	ComputerCapability
> = async ({ client }) => {
	if (!client.computer) throw new Error("missing client computer");
	return client.computer;
};
