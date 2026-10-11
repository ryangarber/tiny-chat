import { CapacitorHttp } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";
import type { ClientRuntime } from "#gui/core/types/runtime.ts";
import {
	type MobileUpdate,
	zMobileRelease,
	zMobileUpdate,
} from "#mobile/core/types/update.ts";

/** Where every release's artifacts are uploaded, as the desktop app's are. */
const releases = "https://github.com/RyanGarber/tiny-chat/releases";

/** This build's release (`scripts/build.ts`); a dev build has none. */
const release = import.meta.env.MOBILE_RELEASE
	? zMobileRelease.parse(JSON.parse(import.meta.env.MOBILE_RELEASE))
	: undefined;

/** What `check` last found, for `install`. */
let latest: MobileUpdate | undefined;

/**
 * A live update's bundle is named for the binary it was installed over, whose
 * version `scripts/build.ts` sets to its release's.
 */
const getBundleId = (version: string, native: string) => `${version}_${native}`;
const getNativeVersion = (bundleId: string) =>
	bundleId.slice(bundleId.indexOf("_") + 1);

export const UpdateService = {
	/**
	 * Keeps the build that is running, which Live Update otherwise rolls back
	 * to the binary's own. A live update installed over another binary than
	 * this one is older than its own build, and gives way to it.
	 */
	ready: async () => {
		await LiveUpdate.ready();
		const { bundleId } = await LiveUpdate.getCurrentBundle();
		if (!bundleId) return;
		const { versionName } = await LiveUpdate.getVersionName();
		if (getNativeVersion(bundleId) !== versionName) {
			await LiveUpdate.reset();
			await LiveUpdate.reload();
		}
	},

	/**
	 * Live updates to the web build from the latest release, where its native
	 * code is the same as this binary's; a release build only.
	 */
	create: (platform: "ios" | "android"): ClientRuntime["update"] =>
		release && {
			check: async () => {
				const response = await CapacitorHttp.get({
					url: `${releases}/latest/download/mobile-update.json`,
					responseType: "text",
				});
				// The latest release has yet to upload one.
				if (response.status === 404) return null;
				if (response.status !== 200)
					throw new Error(`The update check failed (${response.status})`);
				const update = zMobileUpdate.parse(
					typeof response.data === "string"
						? JSON.parse(response.data)
						: response.data,
				);
				if (
					update.version === release.version ||
					update.fingerprints[platform] !== release.fingerprints[platform]
				)
					return null;
				latest = update;
				return { version: update.version };
			},
			install: async ({ onProgress }) => {
				if (!latest) throw new Error("There is no update to install");
				const { versionName } = await LiveUpdate.getVersionName();
				const bundleId = getBundleId(latest.version, versionName);
				const { bundleIds } = await LiveUpdate.getBundles();
				if (!bundleIds.includes(bundleId)) {
					const listener = await LiveUpdate.addListener(
						"downloadBundleProgress",
						({ progress }) => onProgress(progress),
					);
					try {
						await LiveUpdate.downloadBundle({
							bundleId,
							url: `${releases}/download/${latest.version}/Tiny.Chat_Mobile.zip`,
							checksum: latest.checksum,
						});
					} finally {
						await listener.remove();
					}
				}
				await LiveUpdate.setNextBundle({ bundleId });
				// Reloads the webview into it; the native app keeps running.
				await LiveUpdate.reload();
			},
		},
} as const;
