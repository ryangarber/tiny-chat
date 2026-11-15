import { z } from "zod";

/** A release's web build: its version, and the native apps it runs on. */
export const zMobileRelease = z.object({
	version: z.string(),
	/** Each platform's `scripts/fingerprint.ts` when it was built. */
	fingerprints: z.object({ ios: z.string(), android: z.string() }),
});
export type MobileRelease = z.infer<typeof zMobileRelease>;

/** `mobile-update.json` at a release: its build, and its bundle's SHA-256. */
export const zMobileUpdate = zMobileRelease.extend({ checksum: z.string() });
export type MobileUpdate = z.infer<typeof zMobileUpdate>;
