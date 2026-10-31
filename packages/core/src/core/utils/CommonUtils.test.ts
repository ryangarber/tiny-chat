import { describe, expect, it } from "vitest";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

const now = Temporal.PlainDateTime.from("2026-10-08T14:37:12");
const timezone = "America/New_York";

describe("CommonUtils.getScheduled", () => {
	const daily = {
		schedule: "DTSTART:20261008T090000Z\nRRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
		timezone,
	};

	it("runs at the wall-clock time where it was scheduled", () => {
		// 9am in New York is 13:00 UTC under daylight saving time.
		expect(CommonUtils.getScheduled({ rrule: daily })?.toString()).toBe(
			"2026-10-08T13:00:00",
		);
	});

	it("follows the wall clock across daylight saving time", () => {
		// Clocks go back on Nov 1, so 9am is 14:00 UTC from then on.
		expect(
			CommonUtils.getScheduled({
				rrule: daily,
				after: Temporal.PlainDateTime.from("2026-10-31T13:00:00"),
			})?.toString(),
		).toBe("2026-11-01T14:00:00");
	});

	it("searches after a UTC time, in the schedule's timezone", () => {
		// 12:00 UTC is 8am in New York, before that day's run.
		expect(
			CommonUtils.getScheduled({
				rrule: daily,
				after: Temporal.PlainDateTime.from("2026-10-09T12:00:00"),
			})?.toString(),
		).toBe("2026-10-09T13:00:00");
		// 13:00 UTC is the run itself, so the next is the day after.
		expect(
			CommonUtils.getScheduled({
				rrule: daily,
				after: Temporal.PlainDateTime.from("2026-10-09T13:00:00"),
			})?.toString(),
		).toBe("2026-10-10T13:00:00");
	});

	it("reads UTC schedules unchanged", () => {
		expect(
			CommonUtils.getScheduled({
				rrule: { ...daily, timezone: "UTC" },
			})?.toString(),
		).toBe("2026-10-08T09:00:00");
	});

	it("ends with the schedule", () => {
		expect(
			CommonUtils.getScheduled({
				rrule: {
					schedule: "DTSTART:20261008T090000Z\nRRULE:FREQ=DAILY;COUNT=1",
					timezone,
				},
				after: Temporal.PlainDateTime.from("2026-10-08T13:00:00"),
			}),
		).toBeNull();
	});
});

describe("CommonUtils.parseSchedule", () => {
	it("reads words, starting on the hour given", () => {
		const schedule = CommonUtils.parseSchedule({
			text: "every weekday at 9am",
			timezone,
			now,
		});
		expect(schedule).toBe(
			"DTSTART:20261008T143700Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
		);
		// Started at 2:37pm New York time, so it runs at 9am the next weekday.
		expect(
			CommonUtils.getScheduled({
				rrule: { schedule: schedule ?? "", timezone },
			})?.toString(),
		).toBe("2026-10-09T13:00:00");
	});

	it("starts at the wall-clock time now in its timezone", () => {
		const schedule = CommonUtils.parseSchedule({
			text: "every hour",
			timezone,
		});
		const nextRunAt = CommonUtils.getScheduled({
			rrule: { schedule: schedule ?? "", timezone },
		});
		const fromNow = Temporal.Now.plainDateTimeISO("UTC").until(
			nextRunAt ?? Temporal.PlainDateTime.from("1970-01-01"),
		);
		// Not hours away, as a start read in the wrong timezone would be.
		expect(fromNow.total("minutes")).toBeGreaterThan(-1);
		expect(fromNow.total("minutes")).toBeLessThan(61);
	});

	it("reads an RRule, keeping its start", () => {
		expect(
			CommonUtils.parseSchedule({
				text: "DTSTART:20260101T080000Z\nRRULE:FREQ=DAILY",
				timezone,
				now,
			}),
		).toBe("DTSTART:20260101T080000Z\nRRULE:FREQ=DAILY;BYSECOND=0");
		expect(
			CommonUtils.parseSchedule({ text: "FREQ=HOURLY", timezone, now }),
		).toBe("DTSTART:20261008T143700Z\nRRULE:FREQ=HOURLY;BYSECOND=0");
	});

	it("rejects what isn't a schedule", () => {
		expect(CommonUtils.parseSchedule({ text: "", timezone, now })).toBeNull();
		expect(
			CommonUtils.parseSchedule({ text: "gibberish", timezone, now }),
		).toBeNull();
		expect(
			CommonUtils.parseSchedule({ text: "FREQ=NOPE", timezone, now }),
		).toBeNull();
	});
});

describe("CommonUtils.formatCount", () => {
	it.each([
		[0, "0"],
		[999.6, "1K"],
		[950, "950"],
		[1000, "1K"],
		[1700, "1.7K"],
		[1749, "1.7K"],
		[9999, "9.9K"],
		[12_345, "12K"],
		[999_999, "999K"],
		[1_000_000, "1M"],
		[1_250_000, "1.2M"],
		[2_000_000_000, "2B"],
		[-1700, "-1.7K"],
	])("writes %d as %s", (value, expected) => {
		expect(CommonUtils.formatCount(value)).toBe(expected);
	});
});
