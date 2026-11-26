import { initTRPC } from "@trpc/server";
import { JsonService } from "#core/core/services/JsonService.ts";
import type { ApiContext } from "#server/core/utils/ApiContext.ts";

const trpc = initTRPC.context<ApiContext>().create({
	transformer: JsonService.transformer,
	// Subscriptions are held open for as long as an instance runs; pings keep
	// proxies from closing them as idle, and tell the client to reconnect when
	// they stop coming.
	sse: {
		ping: { enabled: true, intervalMs: 15_000 },
		client: { reconnectAfterInactivityMs: 40_000 },
	},
});

export const router = trpc.router;
export const procedure = trpc.procedure;
