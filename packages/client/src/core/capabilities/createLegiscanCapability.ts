import type { Client } from "#client/client.ts";
import type {
	CapabilityFactory,
	LegiscanCapability,
} from "#core/core/types/capability.ts";

export const createLegiscanCapability: CapabilityFactory<
	{ client: Client },
	LegiscanCapability
> = async ({ client }) => ({
	listSessions: async (input) => client.api.legiscan.listSessions.query(input),
	listBills: async (input) => client.api.legiscan.listBills.query(input),
	getBill: async (input) => client.api.legiscan.getBill.query(input),
});
