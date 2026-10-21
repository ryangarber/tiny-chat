import type { z } from "zod";
import {
	type zLegiscanBillSummary,
	zLegiscanListBillsInput,
} from "#core/features/tool/types/legiscan.ts";
import { LegiscanUtils } from "#core/features/tool/utils/LegiscanUtils.ts";

const bill = (
	overrides: Partial<z.infer<typeof zLegiscanBillSummary>>,
): z.infer<typeof zLegiscanBillSummary> => ({
	bill_id: 1,
	bill_number: "HB1",
	title: "Housing",
	description: "Affordable housing funding",
	url: "https://legiscan.com/bill/1",
	status: "Introduced",
	status_date: "2026-01-01",
	last_action: "Referred to committee",
	last_action_date: "2026-01-01",
	...overrides,
});
const bills = [
	bill({}),
	bill({
		bill_id: 2,
		bill_number: "HB2",
		status: "Passed",
		last_action_date: "2026-02-01",
	}),
	bill({
		bill_id: 3,
		bill_number: "SB3",
		status: "Chaptered",
		last_action_date: "2026-02-02",
	}),
	bill({
		bill_id: 4,
		bill_number: "HB12",
		title: "Education",
		description: "School funding",
		last_action_date: null,
	}),
];
const list = (input: z.input<typeof zLegiscanListBillsInput>) =>
	LegiscanUtils.listBills(bills, zLegiscanListBillsInput.parse(input));

describe("LegiscanUtils.listBills", () => {
	it("counts the full session while filtering passed bills without conflating enactment", () => {
		const page = list({ session_id: 10, statuses: ["Passed"] });
		expect(page.total).toBe(4);
		expect(page.status_counts).toEqual({
			Introduced: 2,
			Passed: 1,
			Chaptered: 1,
		});
		expect(page.matched).toBe(1);
		expect(page.bills.map((b) => b.bill_id)).toEqual([2]);
	});
	it("paginates newest actions first, putting undated bills last without mutating the index", () => {
		const first = list({ session_id: 10, limit: 2 });
		expect(first.bills.map((b) => b.bill_id)).toEqual([3, 2]);
		expect(first.next_offset).toBe(2);
		const last = list({
			session_id: 10,
			limit: 2,
			offset: first.next_offset ?? 0,
		});
		expect(last.bills.map((b) => b.bill_id)).toEqual([1, 4]);
		expect(last.next_offset).toBeNull();
		expect(bills.map((b) => b.bill_id)).toEqual([1, 2, 3, 4]);
	});
	it("finds exact bill numbers with spaces without matching similarly numbered bills", () => {
		expect(
			list({ session_id: 10, query: "hb 1" }).bills.map((b) => b.bill_id),
		).toEqual([1]);
	});
	it("combines topic and inclusive latest-action filters, excluding unknown dates", () => {
		const page = list({
			session_id: 10,
			query: "AFFORDABLE",
			since: "2026-02-01",
		});
		expect(page.bills.map((b) => b.bill_id)).toEqual([3, 2]);
		expect(
			list({ session_id: 10, query: "school", since: "2026-01-01" }).matched,
		).toBe(0);
	});
	it("returns explicit empty pagination for no matches or an exhausted page", () => {
		expect(list({ session_id: 10, query: "no match" })).toMatchObject({
			matched: 0,
			bills: [],
			next_offset: null,
		});
		expect(list({ session_id: 10, offset: 100 })).toMatchObject({
			matched: 4,
			bills: [],
			next_offset: null,
		});
	});
});
