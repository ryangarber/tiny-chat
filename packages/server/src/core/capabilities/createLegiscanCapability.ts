import type {
	CapabilityFactory,
	LegiscanCapability,
} from "#core/core/types/capability.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { LegiscanProvider } from "#core/features/provider/providers/other/LegiscanProvider.ts";
import {
	zLegiscanBill,
	zLegiscanBillSummary,
	zLegiscanSession,
} from "#core/features/tool/types/legiscan.ts";

export const createLegiscanCapability: CapabilityFactory<
	{ user: zUser },
	LegiscanCapability
> = async ({ user }) => {
	const client = LegiscanProvider.getClient({ user });
	return {
		listSessions: async (input) =>
			zLegiscanSession.array().parse(await client.getSessionList(input)),
		listBills: async ({ session_id }) =>
			zLegiscanBillSummary
				.array()
				.parse(await client.getMasterList({ session: session_id })),
		getBill: async ({ bill_id }) =>
			zLegiscanBill.parse(await client.getBill({ id: bill_id })),
	};
};
