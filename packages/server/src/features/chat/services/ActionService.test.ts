import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import { ActionService } from "#server/features/chat/services/ActionService.ts";
import { MessageService } from "#server/features/message/services/MessageService.ts";
import { testUser } from "#server/tests.ts";

const user = testUser();
const config = zConfig.parse({ provider: "test", model: "test-generate" });
const timezone = "America/New_York";

const data = [
	[
		{
			id: CommonUtils.getRandomId(),
			type: "text" as const,
			value: "Water the plants.",
		},
	],
];

/** The hour a UTC time falls on in New York. */
const localHour = (time: Temporal.PlainDateTime) =>
	time.toZonedDateTime("UTC").withTimeZone(timezone).hour;

describe("ActionService", () => {
	it("runs a schedule at its wall-clock time, starting from when it was written", async () => {
		const message = await MessageService.createMessage({
			user,
			author: "USER",
			config,
			data,
			metadata: [],
		});

		// Written as the agent writes it: local time, no start.
		const action = await ActionService.createAction({
			user,
			message,
			data,
			schedule: "FREQ=DAILY;BYHOUR=9",
			timezone,
		});

		expect(action.schedule).toMatch(
			/^DTSTART;TZID=America\/New_York:\d{8}T\d{6}\n/,
		);
		expect(action.nextRunAt).not.toBeNull();
		if (!action.nextRunAt) return;
		// 9am in New York, whatever its offset from UTC that day.
		expect(localHour(action.nextRunAt)).toBe(9);
		expect(action.nextRunAt.minute).toBe(0);
		// The next one, not one already gone by.
		const now = Temporal.Now.plainDateTimeISO("UTC");
		expect(Temporal.PlainDateTime.compare(action.nextRunAt, now)).toBe(1);
		expect(now.until(action.nextRunAt).total("hours")).toBeLessThan(24);

		// Read again later, it has settled on the same run.
		const [stored] = (await ActionService.getActions({ user })).filter(
			(other) => other.id === action.id,
		);
		expect(stored.nextRunAt?.toString()).toBe(action.nextRunAt.toString());

		const updated = await ActionService.updateAction({
			id: action.id,
			user,
			message,
			data,
			schedule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8",
			timezone,
		});
		expect(updated.nextRunAt && localHour(updated.nextRunAt)).toBe(8);
		expect(
			updated.nextRunAt?.toZonedDateTime("UTC").withTimeZone(timezone)
				.dayOfWeek,
		).toBe(1);

		await ActionService.deleteAction({ user, id: action.id });
	});

	it("rejects a schedule it cannot read", async () => {
		const message = await MessageService.createMessage({
			user,
			author: "USER",
			config,
			data,
			metadata: [],
		});
		await expect(
			ActionService.createAction({
				user,
				message,
				data,
				schedule: "FREQ=NOPE",
				timezone,
			}),
		).rejects.toThrow("Invalid schedule");
	});
});
