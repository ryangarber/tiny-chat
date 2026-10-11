import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "better-auth";
import { config } from "dotenv";
import { internalIpV4Sync } from "internal-ip";
import { print } from "./use-stdout.ts";

export function useEnv<T extends z.ZodObject>({
	type,
	remote,
}: {
	type: T;
	remote?: boolean;
}): z.infer<T> {
	process.env.DEV_ENV ??= resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../.env",
	);

	const env = config({ path: process.env.DEV_ENV, quiet: true });

	if (process.env.DEV) {
		// Inherited by what this process starts (Vite, the server), which load
		// the environment again without knowing to.
		if (remote) process.env.DEV_REMOTE = "true";
		process.env.DEV_HOST =
			process.env.DEV_REMOTE === "true" ? internalIpV4Sync() : "localhost";
	}

	print({
		message: `using ${process.env.DEV_ENV} [${Object.entries(env.parsed ?? {}).length}]`,
	});

	return type.parse({
		...process.env,
		DEV_HOST: process.env.DEV_HOST,
		DEV_ENV: process.env.DEV_ENV,
	});
}
