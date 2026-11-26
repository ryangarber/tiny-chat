import type { IncomingMessage, ServerResponse } from "node:http";
import { TRPCError } from "@trpc/server";
import { AuthService } from "#server/core/services/AuthService.ts";
import { AuthServer } from "#server/core/utils/AuthServer.ts";

export const ApiContext = async ({
	req,
	res,
}: {
	req: IncomingMessage;
	res: ServerResponse;
}) => {
	const session = await AuthServer.api.getSession({
		headers: AuthService.headers(req.headers),
	});
	if (!session?.user) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: `Not authenticated.`,
		});
	}
	const instance = req.headers[ApiContext.instanceHeader];
	return {
		req,
		res,
		session,
		/** The client instance calling, so its own writes can be told apart. */
		origin: typeof instance === "string" ? instance : null,
	};
};

/** Names the client instance a call comes from. */
ApiContext.instanceHeader = "x-tiny-chat-instance" as const;

export type ApiContext = Awaited<ReturnType<typeof ApiContext>>;
