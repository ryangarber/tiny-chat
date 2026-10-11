import { prisma8Adapter } from "@ryangarber/better-auth-adapter-prisma";
import { betterAuth } from "better-auth";
import { anonymous, bearer } from "better-auth/plugins";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { userFields } from "#core/prisma/better-auth-adapter.ts";
import { db } from "#server/db.ts";

const dev = CommonUtils.isTruthy(process.env.DEV);

export const AuthServer = userFields.inferClient(
	betterAuth({
		baseURL: dev
			? `http://${process.env.DEV_HOST}:${process.env.VITE_SERVER_PORT}`
			: process.env.VITE_SERVER_URL,
		basePath: CommonUtils.endpoints.auth,
		database: prisma8Adapter(db),
		user: {
			deleteUser: {
				enabled: true,
			},
			additionalFields: userFields.additionalFields,
		},
		// In dev, the GUI's Vite server: from a host app's webview at DEV_HOST,
		// which is the LAN's address for a phone, and from a browser on this
		// machine at localhost.
		trustedOrigins: [
			...(dev
				? [
						`http://${process.env.DEV_HOST}:${process.env.VITE_WEB_PORT}`,
						`http://localhost:${process.env.VITE_WEB_PORT}`,
					]
				: []),
			process.env.VITE_WEB_URL as string,
		],
		socialProviders: {
			github: {
				clientId: process.env.AUTH_GITHUB_CLIENT as string,
				clientSecret: process.env.AUTH_GITHUB_SECRET,
			},
			google: {
				clientId: process.env.AUTH_GOOGLE_CLIENT as string,
				clientSecret: process.env.AUTH_GOOGLE_SECRET,
			},
			huggingface: {
				clientId: process.env.AUTH_HUGGINGFACE_CLIENT as string,
				clientSecret: process.env.AUTH_HUGGINGFACE_SECRET,
			},
		},
		plugins: [
			anonymous({
				generateName: () => CommonUtils.getRandomName(),
				onLinkAccount: async ({ anonymousUser, newUser }) => {
					const updates = globalThis.db.transaction(async (tx) => {
						// merge user fields that better auth may not know about
						// (made gross thanks to prisma's new readonly return types)
						const fields = ["settings", "cache"] as const;

						const anonymousFields = (await tx.orm.public.User.where({
							id: anonymousUser.user.id,
						})
							.select(...fields)
							.first()) as Record<
							(typeof fields)[number],
							object | null
						> | null;

						const newFields = (await tx.orm.public.User.where({
							id: newUser.user.id,
						})
							.select(...fields)
							.first()) as Record<
							(typeof fields)[number],
							object | null
						> | null;

						await tx.orm.public.User.where({
							id: newUser.user.id,
						}).updateAndCount(
							Object.fromEntries(
								fields.map((field) => [
									field,
									{ ...anonymousFields?.[field], ...newFields?.[field] },
								]),
							),
						);

						// merge all other user tables
						await db.orm.public.Project.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.Chat.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.Message.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.Action.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.Memory.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.Upload.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.File.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.Subagent.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });

						await db.orm.public.Dream.where({
							userId: anonymousUser.user.id,
						}).updateAndCount({ userId: newUser.user.id });
					});

					console.log("[AuthService] transferred user records:", updates);
				},
			}),
			bearer(),
			{
				id: "token-storage",
				async onResponse(res) {
					const token = res.headers.get("set-auth-token");
					const location = res.headers.get("location");
					if (token && location) {
						const url = new URL(location);
						url.hash = url.hash
							? `${url.hash}&token=${token}`
							: `#token=${token}`;
						res.headers.set("location", url.toString());
						console.log("[AuthService] redirecting:", url.toString());
					}
					await new Promise<void>((r) => r());
				},
			},
		],
	} satisfies Parameters<typeof betterAuth>[0]),
);
