import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { z } from "zod";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

/** Where the providers' authorization pages live; nothing else is redirected to. */
const PROVIDER_HOSTS = new Set([
	"accounts.google.com",
	"github.com",
	"huggingface.co",
]);

/**
 * Sign-in from a host app (mobile, desktop) through the system browser.
 *
 * The app calls `signIn.social` itself, with its anonymous bearer token and
 * `callbackURL` set to `CommonUtils.nativeAuthCallbackUrl`, so the anonymous
 * plugin keeps its user in the OAuth state and merges it on the callback. That
 * call sets the signed `state` cookie in the webview, though, and the callback
 * arrives in the browser. The app opens the provider's page through this
 * endpoint instead, which sets the cookie in the browser first (as Better
 * Auth's Expo plugin does), but only for states this server issued for the
 * app's callback.
 */
export const nativeAuth = () =>
	({
		id: "native-auth",
		endpoints: {
			nativeAuthorize: createAuthEndpoint(
				CommonUtils.nativeAuthorizePath,
				{
					method: "GET",
					query: z.object({ url: z.string() }),
				},
				async (ctx) => {
					let url: URL;
					try {
						url = new URL(ctx.query.url);
					} catch {
						throw new APIError("BAD_REQUEST", { message: "invalid url" });
					}
					if (url.protocol !== "https:" || !PROVIDER_HOSTS.has(url.hostname)) {
						throw new APIError("BAD_REQUEST", { message: "unknown provider" });
					}

					const state = url.searchParams.get("state");
					const verification =
						state &&
						(await ctx.context.internalAdapter.findVerificationValue(
							`auth-state:${state}`,
						));
					if (!state || !verification) {
						throw new APIError("BAD_REQUEST", { message: "unknown state" });
					}
					const { callbackURL } = z
						.object({ callbackURL: z.string() })
						.parse(JSON.parse(verification.value));
					if (callbackURL !== CommonUtils.nativeAuthCallbackUrl) {
						throw new APIError("BAD_REQUEST", {
							message: "not a native sign-in",
						});
					}

					const cookie = ctx.context.createAuthCookie("state", { maxAge: 300 });
					await ctx.setSignedCookie(
						cookie.name,
						state,
						ctx.context.secret,
						cookie.attributes,
					);
					throw ctx.redirect(url.toString());
				},
			),
		},
	}) satisfies BetterAuthPlugin;
