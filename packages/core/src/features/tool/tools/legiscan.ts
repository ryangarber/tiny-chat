import type { LegiscanCapability } from "#core/core/types/capability.ts";
import {
	zLegiscanBill,
	zLegiscanBillInput,
	zLegiscanBillPage,
	zLegiscanListBillsInput,
	zLegiscanSession,
	zLegiscanSessionsInput,
} from "#core/features/tool/types/legiscan.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
	Toolset,
	ToolsetFactory,
} from "#core/features/tool/types/tool.ts";
import { LegiscanUtils } from "#core/features/tool/utils/LegiscanUtils.ts";

export const legiscan_list_sessions = {
	name: "legiscan_list_sessions",
	description:
		"List legislative sessions for a state, DC, or US Congress. Resolve session IDs and regular/special sessions before looking up bills.",
	input: zLegiscanSessionsInput,
	output: zLegiscanSession,
} as const satisfies ToolDefinition;

export const legiscan_list_bills = {
	name: "legiscan_list_bills",
	description:
		"Summarize a session's legislation with full-session current status counts and a filtered, paginated bill list, newest latest-action date first. Find bills by topic or exact bill number. This index shows current status and latest action, not debate transcripts or all actions in a date range. Use legiscan_get_bill for history and votes.",
	input: zLegiscanListBillsInput,
	output: zLegiscanBillPage,
} as const satisfies ToolDefinition;

export const legiscan_get_bill = {
	name: "legiscan_get_bill",
	description:
		"Get a bill's description, current status, committee, progress, action history, vote summaries, hearing calendar, and text/source links by LegiScan bill ID. A passed vote is distinct from the bill being enacted.",
	input: zLegiscanBillInput,
	output: zLegiscanBill,
} as const satisfies ToolDefinition;

const createListSessions: ToolFactory<
	Tool<typeof legiscan_list_sessions, { legiscan: LegiscanCapability }>
> = (options) => ({
	...legiscan_list_sessions,
	...options,
	execute: async ({ input }) =>
		(await options.capabilities.legiscan.listSessions(input)).map((value) => ({
			type: "json",
			value,
		})),
});
const createListBills: ToolFactory<
	Tool<typeof legiscan_list_bills, { legiscan: LegiscanCapability }>
> = (options) => ({
	...legiscan_list_bills,
	...options,
	execute: async ({ input }) => [
		{
			type: "json",
			value: LegiscanUtils.listBills(
				await options.capabilities.legiscan.listBills({
					session_id: input.session_id,
				}),
				input,
			),
		},
	],
});
const createGetBill: ToolFactory<
	Tool<typeof legiscan_get_bill, { legiscan: LegiscanCapability }>
> = (options) => ({
	...legiscan_get_bill,
	...options,
	execute: async ({ input }) => [
		{ type: "json", value: await options.capabilities.legiscan.getBill(input) },
	],
});

export const createLegiscanToolset: ToolsetFactory<
	Toolset<{ legiscan: LegiscanCapability }>
> = async (options) => ({
	name: "legiscan",
	tools: [
		await createListSessions(options),
		await createListBills(options),
		await createGetBill(options),
	],
	...options,
});
