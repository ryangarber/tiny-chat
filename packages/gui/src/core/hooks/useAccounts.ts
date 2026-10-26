import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { NativeAuthUtils } from "#gui/core/utils/NativeAuthUtils.ts";

export const linkAccountKey = ["useAccounts", "linkAccount"] as const;

/** The sign-in waiting in the system browser, shared by every provider's row. */
let linkAbort: AbortController | null = null;

export const useAccounts = () => {
	const client = useContext(ClientContext);
	const runtime = useRuntime();

	const accounts = useQuery({
		...client.query.user.getAccounts.queryOptions(),
		select: (data) => data,
	});

	const linkAccount = useMutation({
		mutationKey: linkAccountKey,
		mutationFn: async (providerId: string) => {
			if (!runtime.auth) {
				await client.auth.signIn.social({
					provider: providerId,
					callbackURL: window.location.href,
				});
				return;
			}

			// In the system browser, which returns to the app by its URL scheme;
			// `useNativeAuth` signs in with what it returns. Started here, with the
			// app's session, so an anonymous user's chats come along.
			linkAbort?.abort();
			const abort = new AbortController();
			linkAbort = abort;
			const callback = NativeAuthUtils.wait(runtime.auth, abort.signal);
			callback.catch(() => {});
			const { data, error } = await client.auth.signIn.social({
				provider: providerId,
				callbackURL: CommonUtils.nativeAuthCallbackUrl,
				errorCallbackURL: CommonUtils.nativeAuthCallbackUrl,
				disableRedirect: true,
			});
			if (error || !data?.url) {
				abort.abort();
				throw new Error(error?.message ?? "no sign-in url");
			}
			const url = new URL(
				`${client.serverUrl}${CommonUtils.endpoints.auth}${CommonUtils.nativeAuthorizePath}`,
			);
			url.searchParams.set("url", data.url);
			await runtime.open(url.toString());

			const result = await callback.catch(() => null);
			if (linkAbort === abort) linkAbort = null;
			if (result && "error" in result) throw new Error(result.error);
		},
		onSuccess: async () => {
			await client.queryClient.invalidateQueries({
				queryKey: client.query.user.getAccounts.queryKey(),
			});
		},
	});

	const unlinkAccount = useMutation({
		mutationFn: async (accountId: string) => {
			await client.auth.unlinkAccount({ accountId });
		},
		onSuccess: async () => {
			await client.queryClient.invalidateQueries({
				queryKey: client.query.user.getAccounts.queryKey(),
			});
		},
	});

	const deleteUser = useMutation({
		mutationFn: async () => {
			await client.auth.deleteUser();
		},
		onSuccess: async () => {
			await client.queryClient.invalidateQueries({
				queryKey: client.query.user.getAccounts.queryKey(),
			});
		},
	});

	/** Stops waiting on a sign-in in the system browser. */
	const cancelLink = () => {
		linkAbort?.abort();
		linkAbort = null;
	};

	return { accounts, linkAccount, cancelLink, unlinkAccount, deleteUser };
};
