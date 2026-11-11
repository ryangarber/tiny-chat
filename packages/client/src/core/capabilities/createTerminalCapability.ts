import type { Client } from "#client/client.ts";
import type {
	CapabilityFactory,
	TerminalCapability,
} from "#core/core/types/capability.ts";

/** The host's tmux, whose sessions outlive a message. */
export const createTerminalCapability: CapabilityFactory<
	{ client: Client },
	TerminalCapability
> = async ({ client }) => {
	if (!client.computah) throw new Error("missing client terminal");
	return client.computah.terminal;
};
