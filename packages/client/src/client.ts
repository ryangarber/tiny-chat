import { QueryClient } from "@tanstack/react-query";
import {
	createTRPCClient,
	httpLink,
	httpSubscriptionLink,
	splitLink,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import {
	anonymousClient,
	inferAdditionalFields,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { inferAuthClient } from "better-auth-prisma-orm/client";
import { EventSource } from "eventsource";
import { createContext } from "react";
import type { ClientComputah } from "#client/features/agent/types/computah.ts";
import type { ClientTransports } from "#client/features/agent/types/transport.ts";
import { ChatEventService } from "#client/features/chat/services/ChatEventService.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { WorkingDirectoryService } from "#client/features/chat/services/WorkingDirectoryService.ts";
import type { ClientInput } from "#client/features/editor/services/ComposerService.ts";
import {
	type HostShellPrimitives,
	HostShellService,
} from "#client/features/shell/services/HostShellService.ts";
import { JsonService } from "#core/core/services/JsonService.ts";
import type { zClientEnv, zProviderEnv } from "#core/core/types/env.ts";
import { CodeUtils, type CodeWorker } from "#core/core/utils/CodeUtils.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import type { ModelProvider } from "#core/features/provider/types/model.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import type { userFields } from "#core/prisma/better-auth-adapter.ts";
import type { ApiRouter } from "#server/core/utils/ApiRouter.ts";
import type { AuthServer } from "#server/core/utils/AuthServer.ts";

export interface ClientProviders {
	getModelProviders: (_: {
		client: Client;
		user: zUser;
	}) => Promise<ModelProvider<any>[]>;

	getProviderStates: (_: {
		client: Client;
		user: zUser;
		update?: boolean;
	}) => Promise<ProviderState<ProviderStatus>[]>;
}

export type { ClientTransports };

export type ClientShell = HostShellPrimitives;

export type { ClientComputah };

export const createClient = ({
	env,
	getToken,
	setToken,
	getStorage,
	setStorage,
	providers,
	transports,
	input,
	shell: primitives,
	computah,
	desktop,
	highlighter,
	queryClient = new QueryClient(),
}: {
	env: zClientEnv & { DEV_HOST?: string };
	getToken: () => string | null | undefined;
	setToken: (token: string | null | undefined) => void;
	getStorage: <T>(key: string) => T | null;
	setStorage: <T>(key: string, value: T) => void;
	providers?: ClientProviders;
	transports?: ClientTransports;
	input?: ClientInput;
	shell?: ClientShell;
	/**
	 * The browser, terminal and computer, as the host holds them: the CLI
	 * through `ComputahHostService` itself, the desktop app over its main
	 * process.
	 */
	computah?: ClientComputah;
	desktop?: boolean;
	/** Starts the runtime's bundle of `HighlightWorker.ts`, where Shiki runs. */
	highlighter?: () => CodeWorker;
	queryClient?: QueryClient;
}) => {
	CodeUtils.setWorker(highlighter);

	const webUrl = env.DEV_HOST
		? `http://${env.DEV_HOST}:${env.VITE_WEB_PORT}`
		: env.VITE_WEB_URL;

	const serverUrl = env.DEV_HOST
		? `http://${env.DEV_HOST}:${env.VITE_SERVER_PORT}`
		: env.VITE_SERVER_URL;

	// Every API call needs a session. One made before there is any token, as
	// a first launch's queries are while `useSession` signs in anonymously,
	// waits for it rather than failing as unauthorized.
	const tokenWaiters = new Set<() => void>();
	const waitForToken = () =>
		getToken()
			? Promise.resolve()
			: new Promise<void>((resolve) => tokenWaiters.add(resolve));
	let events: ReturnType<typeof ChatEventService.watch> | undefined;
	const setClientToken = (token: string | null | undefined) => {
		const changed = token !== getToken();
		setToken(token);
		// What is listened to is the session's, so another session listens anew.
		if (changed) events?.restart();
		if (!token) return;
		for (const resolve of tokenWaiters) resolve();
		tokenWaiters.clear();
	};

	const auth = inferAuthClient<typeof userFields>()(
		createAuthClient({
			baseURL: serverUrl,
			basePath: CommonUtils.endpoints.auth,
			fetchOptions: {
				auth: {
					type: "Bearer",
					token: () => getToken() ?? undefined,
				},
			},
			plugins: [anonymousClient(), inferAdditionalFields<typeof AuthServer>()],
		}),
	);

	// This instance, told apart from the user's others in what they hear of
	// its writes.
	const instance = CommonUtils.getRandomId();
	const headers = async () => {
		await waitForToken();
		const token = getToken();
		return {
			Authorization: token ? `Bearer ${token}` : undefined,
			"X-Tiny-Chat-Instance": instance,
		};
	};

	const url = `${serverUrl}${CommonUtils.endpoints.api}`;
	const api = createTRPCClient<ApiRouter>({
		links: [
			splitLink({
				condition: (op) => op.type === "subscription",
				// Server-sent events, by a fetch that can send the session along.
				true: httpSubscriptionLink({
					url,
					transformer: JsonService.transformer,
					EventSource,
					eventSourceOptions: async () => {
						const sent = await headers();
						return {
							fetch: (input, init) =>
								fetch(input, {
									...init,
									headers: {
										...init?.headers,
										...(sent.Authorization && {
											Authorization: sent.Authorization,
										}),
										"X-Tiny-Chat-Instance": sent["X-Tiny-Chat-Instance"],
									},
								}),
						};
					},
				}),
				false: httpLink({
					url,
					transformer: JsonService.transformer,
					headers,
					methodOverride: "POST",
				}),
			}),
		],
	});

	const query = createTRPCOptionsProxy({
		client: api,
		queryClient: queryClient,
	});

	const providerEnv: zProviderEnv = {
		...env,
		PROVIDER_RELAY_URL: serverUrl,
	};

	const shell = primitives && HostShellService.create(primitives);

	const workingDirectory = WorkingDirectoryService.create({
		shell,
		activate: (selection) => api.chat.activate.mutate(selection),
	});

	const client = {
		workingDirectory,
		webUrl,
		serverUrl,
		api,
		query,
		queryClient,
		auth,
		providerEnv,
		getToken,
		setToken: setClientToken,
		getStorage,
		setStorage,
		providers,
		transports,
		input,
		shell,
		computah,
		desktop,
	};

	ChatService.watch({ client });
	events = ChatEventService.watch({ client, instance });

	return client;
};

export type Client = Awaited<ReturnType<typeof createClient>>;

export const ClientContext = createContext<Client>(null as any);
