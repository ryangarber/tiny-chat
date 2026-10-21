import { Progress, State } from "@ryangarber/legiscan-ts";
import { z } from "zod";

export const zLegiscanState = z.enum(
	Object.keys(State) as [keyof typeof State],
);
export const zLegiscanStatus = z.enum(
	Object.keys(Progress) as [keyof typeof Progress],
);
export const zLegiscanSessionsInput = z.object({
	state: zLegiscanState.describe(
		"Two-letter state abbreviation, DC, or US for Congress.",
	),
});
export const zLegiscanSessionInput = z.object({
	session_id: z
		.number()
		.int()
		.positive()
		.describe("Session ID from legiscan_list_sessions."),
});
export const zLegiscanBillInput = z.object({
	bill_id: z
		.number()
		.int()
		.positive()
		.describe(
			"LegiScan bill ID from legiscan_list_bills, not the printed bill number.",
		),
});
export const zLegiscanSession = z.object({
	session_id: z.number(),
	state: zLegiscanState,
	session_name: z.string(),
	session_title: z.string(),
	year_start: z.number(),
	year_end: z.number(),
	special: z.boolean(),
	prefile: z.boolean(),
	prior: z.boolean(),
	sine_die: z.boolean(),
});
export const zLegiscanBillSummary = z.object({
	bill_id: z.number(),
	bill_number: z.string(),
	title: z.string(),
	description: z.string(),
	url: z.string(),
	status: zLegiscanStatus,
	status_date: z.string().nullable(),
	last_action: z.string().nullable(),
	last_action_date: z.string().nullable(),
});
export const zLegiscanBill = zLegiscanBillSummary
	.omit({
		last_action: true,
		last_action_date: true,
	})
	.extend({
		session: zLegiscanSession,
		state: zLegiscanState,
		state_link: z.string(),
		completed: z.boolean(),
		current_body_raw: z.string().nullable(),
		committee: z.array(z.object({ name: z.string(), chamber_raw: z.string() })),
		progress: z.array(z.object({ date: z.string(), event: zLegiscanStatus })),
		history: z.array(
			z.object({
				date: z.string(),
				action: z.string(),
				chamber_raw: z.string().nullable(),
				importance: z.boolean(),
			}),
		),
		votes: z.array(
			z.object({
				date: z.string(),
				description: z.string(),
				yea: z.number(),
				nay: z.number(),
				abstain: z.number(),
				absent: z.number(),
				passed: z.boolean(),
				chamber_raw: z.string(),
			}),
		),
		calendar: z.array(
			z.object({
				type: z.string(),
				date: z.string(),
				time: z.string().nullable(),
				location: z.string().nullable(),
				description: z.string(),
			}),
		),
		texts: z.array(
			z.object({
				date: z.string(),
				type: z.string(),
				url: z.string(),
				state_link: z.string(),
			}),
		),
	});

export const zLegiscanListBillsInput = zLegiscanSessionInput.extend({
	query: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"Case-insensitive substring in title/description, or an exact bill number such as HB 123.",
		),
	statuses: z
		.array(zLegiscanStatus)
		.min(1)
		.optional()
		.describe(
			"Current overall bill statuses. Passed, Chaptered and Override are distinct; a chamber vote passing does not imply enactment.",
		),
	since: z.iso
		.date()
		.optional()
		.describe(
			"Only bills whose latest action is on or after this date (inclusive). This is not a search of historical actions.",
		),
	offset: z.number().int().min(0).default(0),
	limit: z.number().int().min(1).max(100).default(25),
});
export const zLegiscanBillPage = z.object({
	session_id: z.number(),
	total: z.number().describe("All bills in the session before filtering."),
	status_counts: z
		.record(z.string(), z.number())
		.describe(
			"Current status counts across the entire session before filtering.",
		),
	matched: z.number(),
	next_offset: z.number().nullable(),
	bills: z.array(zLegiscanBillSummary),
});
