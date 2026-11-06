import { prismaUserFields } from "better-auth-prisma-orm/client";
import type { Contract } from "#core/generated/prisma/contract.d.ts";

export const userFields = prismaUserFields<Contract, "public", "User">()({
	settings: {
		type: "json",
		required: true,
		defaultValue: {},
	},
	isEphemeral: {
		type: "boolean",
		required: true,
		defaultValue: false,
	},
});
