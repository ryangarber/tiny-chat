import type { z } from "zod";
import type {
	zLegiscanBillPage,
	zLegiscanBillSummary,
	zLegiscanListBillsInput,
} from "#core/features/tool/types/legiscan.ts";

export const LegiscanUtils = {
	listBills: (
		bills: z.infer<typeof zLegiscanBillSummary>[],
		input: z.infer<typeof zLegiscanListBillsInput>,
	): z.infer<typeof zLegiscanBillPage> => {
		const status_counts: Record<string, number> = {};
		for (const bill of bills)
			status_counts[bill.status] = (status_counts[bill.status] ?? 0) + 1;
		const query = input.query?.toLowerCase();
		const normalizeNumber = (value: string) =>
			value.replace(/\s/g, "").toLowerCase();
		const matched = bills
			.filter(
				(bill) =>
					(!query ||
						`${bill.title}\n${bill.description}`
							.toLowerCase()
							.includes(query) ||
						normalizeNumber(bill.bill_number) === normalizeNumber(query)) &&
					(!input.statuses || input.statuses.includes(bill.status)) &&
					(!input.since ||
						(!!bill.last_action_date && bill.last_action_date >= input.since)),
			)
			.sort(
				(a, b) =>
					(b.last_action_date ?? "").localeCompare(a.last_action_date ?? "") ||
					a.bill_id - b.bill_id,
			);
		const end = input.offset + input.limit;
		return {
			session_id: input.session_id,
			total: bills.length,
			status_counts,
			matched: matched.length,
			next_offset: end < matched.length ? end : null,
			bills: matched.slice(input.offset, end),
		};
	},
} as const;
