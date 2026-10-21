import { LegiscanClient, State } from "@ryangarber/legiscan-ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import type { OtherProvider } from "#core/features/provider/types/other.ts";

export const LegiscanProvider: OtherProvider & {
	getClient: (_: { user: zUser }) => LegiscanClient;
} = {
	name: "legiscan",
	type: "other",
	settings: ["apiKey"],

	getClient: ({ user }) => {
		const key = user.settings.providers?.legiscan?.apiKey;
		if (typeof key !== "string" || !key.trim())
			throw new Error(
				"Configure a LegiScan API key in provider settings first.",
			);
		return new LegiscanClient(key);
	},

	async getStatus({ user }) {
		if (!user.settings.providers?.legiscan?.apiKey) return { valid: false };

		try {
			const client = LegiscanProvider.getClient({ user });

			await client.getSessionList({ state: State.DC });

			return { valid: true };
		} catch (error) {
			return {
				valid: false,
				error: CommonUtils.formatError({ error }),
			};
		}
	},
};
