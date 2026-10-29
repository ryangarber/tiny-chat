import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useRef } from "react";
import { type Client, ClientContext } from "#client/client.ts";

export const sessionQueryKey = ["useSession"] as const;

/**
 * Signs in with a token from elsewhere. The session query is cancelled too:
 * invalidating it alone would leave a first fetch that is still in flight to
 * finish, and save the token it got (an anonymous user's) over this one.
 *
 * The token is set before that: the query refetches as soon as it is
 * cancelled, while it has no data yet, and that fetch must already send this
 * token — invalidating joins it rather than starting another.
 */
export const setSessionToken = async (client: Client, token: string) => {
	client.setToken(token);
	await client.queryClient.cancelQueries({ queryKey: sessionQueryKey });
	await client.queryClient.invalidateQueries();
};

export const useSession = ({
	token,
	clone,
}: {
	token?: { value: string | null | undefined; onChange: () => void };
	clone?: { value: string | null | undefined; onChange: () => void };
} = {}) => {
	const client = useContext(ClientContext);

	const session = useQuery({
		queryKey: sessionQueryKey,
		// Cancelled when a sign-in elsewhere (a native callback, a `token`)
		// invalidates it mid-flight; it mustn't then save its own token over that
		// one, as a fresh anonymous user's.
		queryFn: async ({ signal }) => {
			let _session = await client.auth.getSession();
			if (_session.error) throw _session.error;
			signal.throwIfAborted();

			if (!_session.data) {
				console.log("[useSession] no session, signing in anonymously...");
				const signIn = await client.auth.signIn.anonymous();
				signal.throwIfAborted();
				if (signIn.data?.token) {
					client.setToken(signIn.data.token);
					_session = await client.auth.getSession();
					if (_session.error || !_session.data) {
						throw _session.error ?? new Error("missing session data");
					}
				} else {
					throw new Error("anonymous sign-in failed");
				}
			}

			signal.throwIfAborted();
			client.setToken(_session.data.session.token);

			console.log("[useSession] session:", _session.data.user.id);
			return _session.data;
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const requestClone = useMutation({
		mutationKey: ["useSession", "requestClone"] as const,
		mutationFn: async (onReady: (url: string) => Promise<void> | void) => {
			console.log("[useSession] requesting clone");

			const id = await client.api.user.createClone.mutate();
			void onReady(id);

			while (true) {
				const result = await client.api.user.completeClone.mutate({ id });
				if (result) break;
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			void client.queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		},
	});

	const acceptClone = useMutation({
		mutationKey: ["useSession", "acceptClone"] as const,
		mutationFn: async (id: string) => {
			console.log("[useSession] accepting clone:", id);
			await client.api.user.continueClone.mutate({ id });
		},
	});

	useEffect(() => {
		if (token?.value) {
			void setSessionToken(client, token.value);
			token.onChange();
		}
	}, [token, client]);

	// A clone waits, in the URL that a sign-in returns to, until the user here
	// has actually signed in: continuing it anonymously would hand the app a
	// throwaway user.
	const signedIn = !!session.data && !session.data.user.isAnonymous;

	const acceptedCloneRef = useRef<string | null>(null);

	useEffect(() => {
		if (!clone?.value || !signedIn) return;
		if (acceptedCloneRef.current === clone.value) return;
		acceptedCloneRef.current = clone.value;
		acceptClone.mutate(clone.value, { onSettled: clone.onChange });
	}, [clone, signedIn, acceptClone.mutate]);

	return {
		session,
		requestClone,
		acceptClone,
	};
};
