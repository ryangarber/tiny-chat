import { TRPCError } from "@trpc/server";
import type { Session } from "better-auth";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zUser } from "#core/features/data/types/user.ts";

/** A signed-in user, as the session has it; an anonymous one can't be cloned. */
type SessionUser = Pick<zUser, "id"> & { isAnonymous?: boolean | null };

interface Clone {
	id: string;
	userId: string | null;
}
const clones: Clone[] = [];

/**
 * Session cloning system for user agents without OAuth capabilities: the app
 * creates a clone, the web continues it once its user has signed in, and the
 * app completes it by taking over that user.
 */
export const CloneService = {
	createClone: (_: { user: SessionUser }) => {
		const id = CommonUtils.getRandomId();
		clones.push({ id, userId: null });
		return id;
	},
	continueClone: ({ user, id }: { user: SessionUser; id: string }) => {
		if (user.isAnonymous) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "sign in before continuing a clone",
			});
		}
		const clone = clones.find((c) => c.id === id);
		if (!clone) throw new Error("clone not found");
		clone.userId = user.id;
	},
	completeClone: async ({
		session,
		id,
	}: {
		user: SessionUser;
		session: Session;
		id: string;
	}) => {
		const clone = clones.find((c) => c.id === id);
		if (!clone) throw new Error("clone not found");

		const userId = clone.userId;
		if (!userId) return false;

		// Continued by a user who has since been deleted or made anonymous again.
		const target = (await globalThis.db.orm.public.User.where({ id: userId })
			.select("isAnonymous")
			.first()) as { isAnonymous: boolean | null } | null;
		if (!target || target.isAnonymous) {
			clones.splice(clones.indexOf(clone), 1);
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "clone was continued by an anonymous user",
			});
		}

		clones.splice(clones.indexOf(clone), 1);
		await globalThis.db.orm.public.Session.where({ id: session.id }).update({
			user: (user) => user.connect({ id: userId }),
		});
		return true;
	},
} as const;
