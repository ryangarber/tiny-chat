import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { RuntimeAuth } from "#gui/core/types/runtime.ts";

export type NativeAuthResult = { token: string } | { error: string };

export const NativeAuthUtils = {
	/**
	 * What a sign-in in the system browser returned to the app with: the
	 * server's `#token=`, or Better Auth's `?error=`. Null for any other URL.
	 */
	parse: (url: string): NativeAuthResult | null => {
		if (!url.startsWith(CommonUtils.nativeAuthCallbackUrl)) return null;
		const parsed = new URL(url);
		const token = new URLSearchParams(parsed.hash.slice(1)).get("token");
		if (token) return { token };
		return { error: parsed.searchParams.get("error") ?? "sign-in failed" };
	},

	/** The next sign-in the app returns with, until `abort`. */
	wait: (auth: RuntimeAuth, abort: AbortSignal) =>
		new Promise<NativeAuthResult>((resolve, reject) => {
			const unsubscribe = auth.onUrl((url) => {
				const result = NativeAuthUtils.parse(url);
				if (!result) return;
				unsubscribe();
				resolve(result);
			});
			abort.addEventListener(
				"abort",
				() => {
					unsubscribe();
					reject(abort.reason);
				},
				{ once: true },
			);
		}),
} as const;
