import { distance } from "fastest-levenshtein";
import { customAlphabet } from "nanoid";
import "temporal-polyfill/full/global";
import { RRuleTemporal } from "rrule-temporal";
import { toText } from "rrule-temporal/totext";
import {
	adjectives,
	colors,
	uniqueNamesGenerator,
} from "unique-names-generator";
import { ID_ALPHABET, ID_LENGTH } from "#core/core/types/common.ts";
import { ScheduleUtils } from "#core/core/utils/ScheduleUtils.ts";

export type MaybeNullish<TIn, TOut> = TIn extends undefined
	? undefined
	: TIn extends null
		? null
		: TOut;

const getRandomName = () => {
	return uniqueNamesGenerator({
		dictionaries: [adjectives, colors],
		length: 2,
		style: "capital",
		separator: " ",
	});
};

const getRandomId = customAlphabet(ID_ALPHABET, ID_LENGTH);

const TIME_UNITS = [
	["year", 365 * 24 * 60 * 60],
	["month", 30 * 24 * 60 * 60],
	["week", 7 * 24 * 60 * 60],
	["day", 24 * 60 * 60],
	["hour", 60 * 60],
	["minute", 60],
	["second", 1],
] as const satisfies [Intl.RelativeTimeFormatUnit, number][];

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const durationFormats = Object.fromEntries(
	TIME_UNITS.map(([unit]) => [
		unit,
		new Intl.NumberFormat("en", { style: "unit", unit, unitDisplay: "long" }),
	]),
);

/** The largest whole unit in `seconds`, as `[unit, value]`. */
const toTimeUnit = (seconds: number) => {
	const [unit, size] =
		TIME_UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? TIME_UNITS[6];
	return [unit, Math.trunc(seconds / size)] as const;
};

/**
 * A stored schedule as a rule in its timezone. Schedules are written in
 * wall-clock time, so a start in UTC — as older schedules, and ones written
 * by a model, are — is that time where it was scheduled. Without a start of
 * its own, it starts at `now`.
 */
const toRule = ({
	schedule,
	timezone,
	now,
}: {
	schedule: string;
	timezone: string;
	now?: Temporal.PlainDateTime;
}) => {
	const rule = new RRuleTemporal({
		rruleString: schedule,
		...(now && { dtstart: now.toZonedDateTime(timezone) }),
	});
	const { dtstart, tzid } = rule.options();
	return tzid === "UTC" && timezone !== "UTC"
		? rule.with({
				dtstart: dtstart.toPlainDateTime().toZonedDateTime(timezone),
				tzid: timezone,
			})
		: rule;
};

export const CommonUtils = {
	endpoints: {
		api: "/@/api",
		auth: "/@/auth",
		mcp: "/@/mcp",
		antigravity: "/@/antigravity",
	},

	/**
	 * Where a sign-in in the system browser returns to a host app, by the URL
	 * scheme it registers (`tinychat`). The server appends `#token=`.
	 */
	nativeAuthCallbackUrl: "tinychat://auth",
	/** The auth path that opens a native sign-in in the system browser. */
	nativeAuthorizePath: "/native/authorize",

	isTruthy: (value?: string) => {
		return value === "true" || value === "1";
	},

	defaultName: getRandomName(),

	getRandomName,

	getRandomId,

	getHash: (data: string) => {
		let hash = 5381;
		for (let i = 0; i < data.length; i++) {
			hash = (hash * 33) ^ data.charCodeAt(i);
		}
		return hash >>> 0;
	},

	toDate: <T extends Temporal.PlainDateTime | Date | null | undefined>(
		datetime?: T,
	): MaybeNullish<T, Date> => {
		if (!datetime) return datetime as MaybeNullish<T, Date>;
		if (datetime instanceof Date)
			return datetime as Date as MaybeNullish<T, Date>;
		return new Date(
			datetime.toZonedDateTime("UTC").epochMilliseconds,
		) as MaybeNullish<T, Date>;
	},

	toPlainDateTime: <T extends Temporal.PlainDateTime | Date | null | undefined>(
		date?: T,
	): MaybeNullish<T, Temporal.PlainDateTime> => {
		if (!date) return date as MaybeNullish<T, Temporal.PlainDateTime>;
		if (date instanceof Date)
			return Temporal.Instant.fromEpochMilliseconds(date.getTime())
				.toZonedDateTimeISO("UTC")
				.toPlainDateTime() as MaybeNullish<T, Temporal.PlainDateTime>;
		return date as Temporal.PlainDateTime as MaybeNullish<
			T,
			Temporal.PlainDateTime
		>;
	},

	parsePlainDateTime: (value: string | number): Temporal.PlainDateTime => {
		const instant =
			typeof value === "number"
				? Temporal.Instant.fromEpochMilliseconds(value)
				: Temporal.Instant.from(value);
		return instant.toZonedDateTimeISO("UTC").toPlainDateTime();
	},

	formatDate: ({
		date = new Date(),
		timezone,
		relative = false,
	}: {
		date?: Date | Temporal.PlainDateTime;
		timezone?: string;
		relative?: boolean;
	}) => {
		date = CommonUtils.toDate(date) ?? new Date();
		if (relative) {
			const [unit, value] = toTimeUnit((date.getTime() - Date.now()) / 1000);
			return relativeFormat.format(value, unit);
		}
		return date.toLocaleString("en-US", {
			timeZone: timezone ?? "UTC",
			dateStyle: "long",
			timeStyle: "short",
		});
	},

	formatTimespan: ({
		from,
		to,
	}: {
		from: Temporal.PlainDateTime | Date;
		to: Temporal.PlainDateTime | Date;
	}) => {
		const [unit, value] = toTimeUnit(
			Math.abs(
				CommonUtils.toDate(to).getTime() - CommonUtils.toDate(from).getTime(),
			) / 1000,
		);
		return durationFormats[unit].format(value);
	},

	formatError: ({ error, details }: { error?: unknown; details?: boolean }) => {
		if (details) {
			return error instanceof Error
				? `${error.name}: ${error.message}\n\nDetails: ${JSON.stringify(error)}`
				: JSON.stringify(error);
		}
		return error instanceof Error
			? `${error.name}: ${error.message}`
			: String(error);
	},

	/**
	 * A count written short, as token counts are shown: `950`, `1K`, `1.7K`,
	 * `12K`, `1.2M`. One decimal below ten of a unit, none above it, and never
	 * rounded up into a unit it hasn't reached.
	 */
	formatCount: (value: number) => {
		const sign = value < 0 ? "-" : "";
		const count = Math.round(Math.abs(value));
		const units = [
			[1e9, "B"],
			[1e6, "M"],
			[1e3, "K"],
		] as const;
		for (const [size, suffix] of units) {
			if (count < size) continue;
			const scaled = count / size;
			const digits = scaled < 10 ? 1 : 0;
			const factor = 10 ** digits;
			// Truncated, so 999,999 reads as 999K rather than 1000K.
			const rounded = Math.floor(scaled * factor) / factor;
			return `${sign}${Number(rounded.toFixed(digits))}${suffix}`;
		}
		return `${sign}${count}`;
	},

	escapeRegex: (value: string) => {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	},

	escapeQuery: (value: string) => {
		return value
			.replace(/["“”]/g, " ")
			.replace(/\bor\b/gi, " ")
			.replace(/(^|\s)-+/g, " $1".trim())
			.replace(/\s+/g, " ")
			.trim();
	},

	toStyleObject: (styleString: string): Record<string, string> => {
		const style: Record<string, string> = {};
		for (const decl of styleString.split(";")) {
			const index = decl.indexOf(":");
			if (index > 0) {
				const prop = decl.slice(0, index).trim();
				const val = decl.slice(index + 1).trim();
				if (prop && val) {
					style[prop] = val;
				}
			}
		}
		return style;
	},

	toStyleString: (style: Record<string, string>): string => {
		return Object.keys(style).reduce((accumulator, key) => {
			const cssKey = key.replace(/([A-Z])/g, "-$1").toLowerCase();
			return `${accumulator}${cssKey}:${style[key]};`;
		}, "");
	},

	toAttributesObject: (attributeString?: string): Record<string, any> => {
		if (!attributeString?.trim()) {
			return {};
		}

		const attributes: Record<string, any> = {};
		const regex = /([a-zA-Z0-9-]+)=(?:"([^"]*)"|'([^']*)'|(\S*))/g;
		let match = regex.exec(attributeString);

		while (match !== null) {
			const [, key, doubleQuoted, singleQuoted, unquoted] = match;
			attributes[key] = doubleQuoted || singleQuoted || unquoted;
			match = regex.exec(attributeString);
		}

		return attributes;
	},

	toAttributesString: (attributes: Record<string, any>): string => {
		return Object.entries(attributes)
			.filter(([, value]) => value !== undefined && value !== null)
			.map(([key, value]) => `${key}="${value}"`)
			.join(" ");
	},

	/**
	 * When a schedule next runs after `after` (its start, when not given), as
	 * UTC. Its RRule is written in wall-clock time — "9am" is 9am where it was
	 * scheduled — so it is stepped through in its timezone, across any
	 * daylight saving change, and only the occurrence is taken to UTC.
	 */
	getScheduled: ({
		rrule,
		after,
	}: {
		rrule: { schedule: string; timezone: string };
		after?: Temporal.PlainDateTime | null;
	}): Temporal.PlainDateTime | null => {
		const rule = toRule(rrule);
		const nextRunAt = after
			? rule.next(after.toZonedDateTime("UTC"))
			: rule.next(rule.options().dtstart, true);
		return nextRunAt?.withTimeZone("UTC").toPlainDateTime() ?? null;
	},

	/**
	 * A schedule written by hand — an RRule, or words like "every weekday at
	 * 9am" — as an RRule starting now, or null when it cannot be read. Its
	 * times, and the start it is given, are wall-clock times in `timezone`, as
	 * `getScheduled` reads them. Times given to the hour start on it, rather
	 * than at the minute it was written.
	 */
	parseSchedule: ({
		text,
		timezone,
		now = Temporal.Now.plainDateTimeISO(timezone),
	}: {
		text: string;
		timezone: string;
		now?: Temporal.PlainDateTime;
	}): string | null => {
		const value = text.trim();
		if (!value) return null;
		try {
			const start = now.round({ smallestUnit: "minute" });
			const rule = /\bFREQ=/i.test(value)
				? toRule({ schedule: value, timezone, now: start })
				: ScheduleUtils.fromText(value, start.toZonedDateTime(timezone));
			if (!rule) return null;
			const { byHour, byMinute, bySecond } = rule.options();
			return rule
				.with({
					...(byHour && !byMinute && { byMinute: [0] }),
					...(!bySecond && { bySecond: [0] }),
				})
				.toString();
		} catch {
			return null;
		}
	},

	/** An RRule in words, or as written when it cannot be read. */
	describeSchedule: (schedule: string | undefined) => {
		if (!schedule) return "";
		try {
			return toText(schedule, "en", { excludeTzAbbreviation: true });
		} catch {
			return schedule;
		}
	},

	getDistance: (a: string, b: string) => {
		const length = Math.max(a.length, b.length);
		const score = distance(a, b);
		return length > 0 ? score / length : 0;
	},

	getWatchMode: (
		target: "gui" | "desktop" | "cli",
		env = process.env,
		argv = process.argv,
	) => {
		let watch = true;
		for (let i = 0; i < argv.length; i++) {
			if (argv[i].startsWith("--no-watch")) {
				const value = argv[i].split("=")[1] ?? argv[i + 1];
				if (value === target) {
					watch = false;
					break;
				}
			}
		}
		if (CommonUtils.isTruthy(env.NO_WATCH)) {
			watch = false;
		} else if ((env.NO_WATCH ?? "").split(/[, ]/).includes(target)) {
			watch = false;
		}
		if (!watch) console.log(`:: watch mode disabled for ${target}`);
		return {
			watch,
			argv: argv.filter((arg) => !arg.startsWith("--no-watch")),
		};
	},
} as const;
