import "temporal-polyfill/full/global";
import { type Freq, RRuleTemporal, type Weekday } from "rrule-temporal";

const WEEKDAYS: Record<string, Weekday> = {
	monday: "MO",
	mon: "MO",
	tuesday: "TU",
	tue: "TU",
	tues: "TU",
	wednesday: "WE",
	wed: "WE",
	thursday: "TH",
	thu: "TH",
	thur: "TH",
	thurs: "TH",
	friday: "FR",
	fri: "FR",
	saturday: "SA",
	sat: "SA",
	sunday: "SU",
	sun: "SU",
};

const MONTHS = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
];

const UNITS: Record<string, Freq> = {
	minute: "MINUTELY",
	hour: "HOURLY",
	day: "DAILY",
	week: "WEEKLY",
	month: "MONTHLY",
	year: "YEARLY",
};

const ADVERBS: Record<string, Freq> = {
	hourly: "HOURLY",
	daily: "DAILY",
	weekly: "WEEKLY",
	monthly: "MONTHLY",
	yearly: "YEARLY",
	annually: "YEARLY",
};

const COUNTS: Record<string, number> = {
	other: 2,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
};

const ORDINALS: Record<string, number> = {
	first: 1,
	second: 2,
	third: 3,
	fourth: 4,
	fifth: 5,
	last: -1,
};

const singular = (token: string) => token.replace(/s$/, "");

const toCount = (token: string | undefined) => {
	if (token === undefined) return null;
	if (/^\d+$/.test(token)) return Number(token) || null;
	return COUNTS[token] ?? null;
};

const toWeekday = (token: string | undefined) =>
	token === undefined ? undefined : WEEKDAYS[singular(token)];

const toMonth = (token: string | undefined) => {
	if (token === undefined) return null;
	const index = MONTHS.findIndex(
		(month) =>
			month === token || (token.length >= 3 && month.startsWith(token)),
	);
	return index === -1 ? null : index + 1;
};

const toMonthDay = (token: string | undefined) => {
	if (token === undefined) return null;
	if (token in ORDINALS) return ORDINALS[token];
	const match = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(token);
	const day = match ? Number(match[1]) : 0;
	return day >= 1 && day <= 31 ? day : null;
};

const toTime = (token: string | undefined) => {
	if (token === "noon") return { hour: 12, minute: 0 };
	if (token === "midnight") return { hour: 0, minute: 0 };
	const match = token && /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(token);
	if (!match) return null;
	let hour = Number(match[1]);
	const minute = Number(match[2] ?? 0);
	const meridiem = match[3];
	if (meridiem) {
		if (hour < 1 || hour > 12) return null;
		hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
	}
	return hour <= 23 && minute <= 59 ? { hour, minute } : null;
};

export const ScheduleUtils = {
	/**
	 * A schedule in English words — "every weekday at 9am", "every 2 weeks on
	 * monday and friday at 17:30", "monthly on the 1st and last day" — as a
	 * rule starting at `dtstart`, or null when the words aren't a schedule.
	 */
	fromText: (
		text: string,
		dtstart: Temporal.ZonedDateTime,
	): RRuleTemporal | null => {
		const tokens = text
			.toLowerCase()
			.replace(/\b([ap])\.m\.?/g, "$1m")
			.replace(/(\d)\s+([ap]m)\b/g, "$1$2")
			.split(/[\s,]+/)
			.filter((token) => token && token !== "and");
		let i = 0;
		const take = <T>(read: (token: string | undefined) => T | null) => {
			const values: T[] = [];
			for (let value = read(tokens[i]); value !== null; ) {
				values.push(value);
				value = read(tokens[++i]);
			}
			return values.length ? values : null;
		};

		if (tokens[i] === "every" || tokens[i] === "each") i++;
		const interval = toCount(tokens[i]);
		if (interval !== null) i++;

		let freq: Freq | undefined;
		let byDay: Weekday[] | undefined;
		let byMonth: number[] | undefined;
		let byMonthDay: number[] | undefined;
		let count: number | undefined;
		let until: Temporal.ZonedDateTime | undefined;
		const times: { hour: number; minute: number }[] = [];

		const word = tokens[i] ?? "";
		if (word in ADVERBS) {
			freq = ADVERBS[word];
			i++;
		} else if (singular(word) in UNITS) {
			freq = UNITS[singular(word)];
			i++;
		} else if (singular(word) === "weekday") {
			freq = "WEEKLY";
			byDay = ["MO", "TU", "WE", "TH", "FR"];
			i++;
		} else if (singular(word) === "weekend") {
			freq = "WEEKLY";
			byDay = ["SA", "SU"];
			i++;
		} else if (toWeekday(word)) {
			freq = "WEEKLY";
			byDay = take((token) => toWeekday(token) ?? null) ?? undefined;
		} else if (toMonth(word)) {
			freq = "YEARLY";
			byMonth = take(toMonth) ?? undefined;
		} else {
			return null;
		}

		while (i < tokens.length) {
			const token = tokens[i++];
			if (token === "on" || token === "the") {
				if (tokens[i] === "the") i++;
				const days = take((token) => toWeekday(token) ?? null);
				if (days) {
					byDay = days;
					continue;
				}
				if (singular(tokens[i] ?? "") === "weekday") {
					byDay = ["MO", "TU", "WE", "TH", "FR"];
					i++;
					continue;
				}
				const monthDays = take(toMonthDay);
				if (!monthDays) return null;
				byMonthDay = monthDays;
				// "on the 1st day of the month" says no more than "on the 1st".
				while (/^(days?|of|the|month)$/.test(tokens[i] ?? "")) i++;
			} else if (token === "at" || toTime(token)) {
				if (token !== "at") i--;
				const read = take(toTime);
				if (!read) return null;
				times.push(...read);
			} else if (token === "in") {
				const months = take(toMonth);
				if (!months) return null;
				byMonth = months;
			} else if (token === "for") {
				const value = toCount(tokens[i++]);
				if (!value || !/^(time|occurrence)s?$/.test(tokens[i++] ?? ""))
					return null;
				count = value;
			} else if (token === "until") {
				const date = ScheduleUtils.toDate(tokens.slice(i), dtstart);
				if (!date) return null;
				until = date
					.toZonedDateTime({
						timeZone: dtstart.timeZoneId,
						plainTime: "23:59:59",
					})
					.withTimeZone("UTC");
				i = tokens.length;
			} else {
				return null;
			}
		}

		const minutes = new Set(times.map(({ minute }) => minute));
		// BYHOUR and BYMINUTE cross, so times on different minutes can't be one rule.
		if (minutes.size > 1) return null;
		return new RRuleTemporal({
			freq,
			dtstart,
			...(interval !== null && interval > 1 && { interval }),
			...(count !== undefined && { count }),
			...(until && { until }),
			...(byDay && { byDay }),
			...(byMonth && { byMonth }),
			...(byMonthDay && { byMonthDay }),
			...(times.length && {
				byHour: [...new Set(times.map(({ hour }) => hour))],
				byMinute: [...minutes],
			}),
		});
	},

	/** A date written as `2026-12-31` or `december 31 [2026]`, after `now`. */
	toDate: (
		tokens: string[],
		now: Temporal.ZonedDateTime,
	): Temporal.PlainDate | null => {
		try {
			if (tokens.length === 1) return Temporal.PlainDate.from(tokens[0]);
			const month = toMonth(tokens[0]);
			const day = toMonthDay(tokens[1]);
			if (!month || !day || day < 1 || tokens.length > 3) return null;
			const year = tokens[2] ? Number(tokens[2]) : now.year;
			const date = Temporal.PlainDate.from(
				{ year, month, day },
				{ overflow: "reject" },
			);
			// Without a year, the next such date.
			return !tokens[2] &&
				Temporal.PlainDate.compare(date, now.toPlainDate()) < 0
				? date.add({ years: 1 })
				: date;
		} catch {
			return null;
		}
	},
} as const;
