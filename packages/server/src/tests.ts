import "./db.ts";

import type { IncomingMessage, ServerResponse } from "node:http";

import { inferPrismaClient } from "@ryangarber/better-auth-adapter-prisma/client";
import { createTRPCClient, httpLink } from "@trpc/client";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createAuthClient } from "better-auth/client";
import {
	anonymousClient,
	inferAdditionalFields,
} from "better-auth/client/plugins";
import { beforeAll } from "vitest";
import { JsonService } from "#core/core/services/JsonService.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import type { userFields } from "#core/prisma/better-auth-adapter.ts";
import { ApiContext } from "#server/core/utils/ApiContext.ts";
import { ApiRouter } from "#server/core/utils/ApiRouter.ts";
import { AuthServer } from "#server/core/utils/AuthServer.ts";

const serverUrl = "http://tests.local";

/**
 * A `fetch` that hands the request straight to a handler in this process
 * instead of the network, so coverage sees the server code it runs. Like a real
 * fetch, it rejects as soon as the request is aborted.
 */
function inProcessFetch(
	handler: (request: Request) => Promise<Response>,
): typeof fetch {
	return async (input, init) => {
		const request = new Request(input, init);
		request.signal.throwIfAborted();
		return await Promise.race([
			handler(request),
			new Promise<never>((_, reject) => {
				request.signal.addEventListener(
					"abort",
					() => reject(request.signal.reason),
					{ once: true },
				);
			}),
		]);
	};
}

const apiFetch = inProcessFetch((request) =>
	fetchRequestHandler({
		router: ApiRouter,
		endpoint: CommonUtils.endpoints.api,
		req: request,
		allowMethodOverride: true,
		// Routes only read the request's headers, as the Node handler gives them.
		createContext: () =>
			ApiContext({
				req: {
					headers: Object.fromEntries(request.headers),
				} as IncomingMessage,
				res: undefined as unknown as ServerResponse,
			}),
	}),
);

const authFetch = inProcessFetch((request) => AuthServer.handler(request));

const nextId = () => crypto.getRandomValues(new Uint8Array(24)).join("");

/**
 * Creates a temporary test user and returns it.
 * Best for simple server tests.
 */
export function testUser(overrides: Partial<zUser> = {}): zUser {
	const user: zUser = {
		id: CommonUtils.getRandomId(),
		name: "Test User",
		settings: {},
		...overrides,
		isEphemeral: true,
	};

	beforeAll(async () => {
		await globalThis.db.orm.public.User.create({
			...user,
			email: `${user.id}@test.com`,
			emailVerified: false,
			image: null,
			updatedAt: Temporal.Now.plainDateTimeISO("UTC"),
			isAnonymous: true,
			cache: { providers: [] },
		});
	});

	afterAll(async () => {
		// TODO - confirm relations delete and remove this
		const dreams = await globalThis.db.orm.public.Dream.where({
			userId: user.id,
		})
			.select("id")
			.all();

		for (const dream of dreams) {
			await globalThis.db.orm.public.DreamMessage.where({
				dreamId: dream.id,
			}).deleteAll();
		}

		const messages = await globalThis.db.orm.public.Message.where({
			userId: user.id,
		})
			.select("id")
			.all();
		for (const message of messages) {
			await globalThis.db.orm.public.MessageContext.where({
				messageId: message.id,
			}).deleteAll();
		}

		await globalThis.db.orm.public.User.where({ id: user.id }).delete();
	});

	return user;
}

/**
 * Crates a temporary user and session and returns an authenticated API client.
 * Best for more complicated, real-world integration tests. Requests run the
 * server's handlers in this process rather than going over HTTP.
 */
export function testClient(user = testUser()) {
	const session = {
		id: nextId(),
		userId: user.id,
		token: nextId(),
		updatedAt: Temporal.Now.plainDateTimeISO("UTC"),
		expiresAt: Temporal.Now.plainDateTimeISO("UTC").add({ hours: 1 }),
	};

	beforeAll(async () => {
		await globalThis.db.orm.public.Session.create(session);
	});

	const authPlugins = [
		anonymousClient(),
		inferAdditionalFields<typeof AuthServer>(),
	];

	return {
		user,
		session,
		api: createTRPCClient<ApiRouter>({
			links: [
				httpLink({
					url: `${serverUrl}${CommonUtils.endpoints.api}/`,
					fetch: apiFetch,
					transformer: JsonService.transformer,
					headers: () => ({ Authorization: `Bearer ${session.token}` }),
					methodOverride: "POST",
				}),
			],
		}),
		auth: inferPrismaClient<typeof userFields>()(
			createAuthClient({
				baseURL: serverUrl,
				basePath: CommonUtils.endpoints.auth,
				fetchOptions: {
					customFetchImpl: authFetch,
					auth: {
						type: "Bearer",
						token: () => session.token,
					},
				},
				plugins: authPlugins,
			}),
		),
	};
}
