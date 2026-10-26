import type { Session } from "better-auth";
import { CloneService } from "#server/features/user/services/CloneService.ts";
import { testClient, testUser } from "#server/tests.ts";

const app = testClient();
const anonymous = testUser();
const signedIn = testUser();

beforeAll(async () => {
	await globalThis.db.orm.public.User.where({ id: signedIn.id }).update({
		isAnonymous: false,
	});
});

const session = { id: app.session.id } as Session;

describe("session clone", () => {
	it("waits for a signed-in user, then moves the app's session to them", async () => {
		const id = CloneService.createClone({ user: app.user });

		expect(() =>
			CloneService.continueClone({
				user: { ...anonymous, isAnonymous: true },
				id,
			}),
		).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
		expect(
			await CloneService.completeClone({ user: app.user, session, id }),
		).toBe(false);

		CloneService.continueClone({
			user: { ...signedIn, isAnonymous: false },
			id,
		});
		expect(
			await CloneService.completeClone({ user: app.user, session, id }),
		).toBe(true);

		const moved = await globalThis.db.orm.public.Session.where({
			id: app.session.id,
		})
			.select("userId")
			.first();
		expect(moved?.userId).toBe(signedIn.id);
	});

	it("refuses a clone continued by a user who is anonymous again", async () => {
		const id = CloneService.createClone({ user: app.user });
		CloneService.continueClone({
			user: { ...anonymous, isAnonymous: false },
			id,
		});
		await expect(
			CloneService.completeClone({ user: app.user, session, id }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
});
