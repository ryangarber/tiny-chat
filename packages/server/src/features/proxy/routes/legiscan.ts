import {
	zLegiscanBillInput,
	zLegiscanSessionInput,
	zLegiscanSessionsInput,
} from "#core/features/tool/types/legiscan.ts";
import { createLegiscanCapability } from "#server/core/capabilities/createLegiscanCapability.ts";
import { procedure, router } from "#server/index.ts";

export const legiscan = router({
	listSessions: procedure
		.input(zLegiscanSessionsInput)
		.query(async ({ ctx, input }) =>
			(await createLegiscanCapability({ user: ctx.session.user })).listSessions(
				input,
			),
		),
	listBills: procedure
		.input(zLegiscanSessionInput)
		.query(async ({ ctx, input }) =>
			(await createLegiscanCapability({ user: ctx.session.user })).listBills(
				input,
			),
		),
	getBill: procedure
		.input(zLegiscanBillInput)
		.query(async ({ ctx, input }) =>
			(await createLegiscanCapability({ user: ctx.session.user })).getBill(
				input,
			),
		),
});
