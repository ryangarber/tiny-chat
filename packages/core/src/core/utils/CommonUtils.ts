import { distance } from "fastest-levenshtein";
import { customAlphabet } from "nanoid";
import "temporal-polyfill/full/global";
import { format } from "timeago.js";
import {
	adjectives,
	colors,
	uniqueNamesGenerator,
} from "unique-names-generator";
import { ID_ALPHABET, ID_LENGTH } from "#core/core/types/common.ts";
import { RRule } from "#core/index.ts";

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
		return relative
			? format(date, timezone)
			: date.toLocaleString("en-US", {
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
		from = CommonUtils.toDate(from);
		to = CommonUtils.toDate(to);
		if (from.getTime() > to.getTime()) {
			[from, to] = [to, from];
		}
		return format(from, undefined, { relativeDate: to }).replace(" ago", "");
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
		const { timezone } = rrule;
		const schedule = RRule.fromString(rrule.schedule);
		// RRule keeps wall-clock times as though they were UTC instants.
		const searchFrom = after
			? after.toZonedDateTime("UTC").withTimeZone(timezone).toPlainDateTime()
			: CommonUtils.toPlainDateTime(schedule.options.dtstart).subtract({
					milliseconds: 1,
				});
		const nextRunAt = CommonUtils.toPlainDateTime(
			schedule.after(CommonUtils.toDate(searchFrom), false),
		);
		return (
			nextRunAt
				?.toZonedDateTime(timezone, { disambiguation: "compatible" })
				.withTimeZone("UTC")
				.toPlainDateTime() ?? null
		);
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
			const parsed = /\bFREQ=/i.test(value)
				? RRule.fromString(value)
				: RRule.fromText(value);
			const { origOptions } = parsed;
			// Words that aren't a schedule still read as a yearly rule, written as nothing.
			if (origOptions.freq === undefined) return null;
			const rule = new RRule({
				...origOptions,
				dtstart:
					origOptions.dtstart ??
					CommonUtils.toDate(now.round({ smallestUnit: "minute" })),
				...(origOptions.byhour !== undefined &&
					origOptions.byminute === undefined && { byminute: 0 }),
				...(origOptions.bysecond === undefined && { bysecond: 0 }),
			});
			return rule.toString();
		} catch {
			return null;
		}
	},

	/** An RRule in words, or as written when it cannot be read. */
	describeSchedule: (schedule: string | undefined) => {
		if (!schedule) return "";
		try {
			return RRule.fromString(schedule).toText();
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
