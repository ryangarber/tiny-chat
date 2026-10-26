import { useContext, useEffect } from "react";
import { ClientContext } from "#client/client.ts";
import { setSessionToken } from "#client/core/hooks/useSession.ts";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { NativeAuthUtils } from "#gui/core/utils/NativeAuthUtils.ts";

const HANDLED_KEY = "nativeAuthToken";

/**
 * Signs the app in with what a sign-in in the system browser returns to it
 * (`useAccounts`), including one that returns after the app was closed.
 */
export const useNativeAuth = () => {
	const client = useContext(ClientContext);
	const { auth } = useRuntime();

	useEffect(
		() =>
			auth?.onUrl((url) => {
				const result = NativeAuthUtils.parse(url);
				if (!result || !("token" in result)) return;
				// A launch URL is handed over again when the page reloads, as signing
				// out does, which would sign back in.
				try {
					if (sessionStorage.getItem(HANDLED_KEY) === result.token) return;
					sessionStorage.setItem(HANDLED_KEY, result.token);
				} catch {}
				console.log("[useNativeAuth] signed in");
				// Everything was the anonymous user's, who is gone now.
				void setSessionToken(client, result.token);
			}),
		[auth, client],
	);
};
