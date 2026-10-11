// biome-ignore-all lint/correctness/noChildrenProp: fixture
/// <reference types="../../../vitest.context.d.ts" />

import "temporal-polyfill/full/global";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { inject } from "vitest";
import { type Client, ClientContext, createClient } from "#client/client.ts";
import type { ClientInput } from "#client/features/editor/services/ComposerService.ts";
import type { zClientEnv } from "#core/core/types/env.ts";

let client: Client;
let token: string | null | undefined;

/**
 * Signs a test client in against the live server. A UI passes the `input` its
 * editor provides, as its host would, so what it renders reads the real thing.
 */
export async function onBeforeAll({
	env,
	input,
}: {
	env: zClientEnv;
	input?: ClientInput;
}) {
	client = createClient({
		env: { ...env, DEV_HOST: new URL(inject("serverUrl")).hostname },
		input,
		getToken: () => token,
		setToken: (value) => (token = value),
		getStorage: () => null,
		setStorage: () => void 0,
		queryClient: new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
					gcTime: 0,
				},
				mutations: {
					retry: false,
					gcTime: 0,
				},
			},
		}),
	});
}

export function create(children: ReactNode) {
	const root = createElement(QueryClientProvider, {
		client: client.queryClient,
		children: createElement(ClientContext, { value: client, children }),
	});

	return { client, root };
}

export async function onAfterAll() {
	client.queryClient.clear();
}
