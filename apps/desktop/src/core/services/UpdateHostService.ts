import { Updater } from "electrobun/main";
import type { DesktopHandlers, DesktopSend } from "#desktop/core/types/rpc.ts";

export const UpdateHostService = {
	/**
	 * Updates from the artifacts each release publishes at `release.baseUrl`.
	 * A dev build never reports one.
	 */
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<"updateCheck" | "updateInstall"> => ({
		updateCheck: async () => {
			if ((await Updater.localInfo.channel()) === "dev") return null;
			const update = await Updater.checkForUpdate();
			if (update.error) throw new Error(update.error);
			return update.updateAvailable ? { version: update.version } : null;
		},
		updateInstall: async () => {
			Updater.onStatusChange((entry) => {
				if (
					entry.status === "download-progress" &&
					entry.details?.progress !== undefined
				)
					send.updateProgress({ fraction: entry.details.progress / 100 });
			});
			try {
				await Updater.downloadUpdate();
				const { updateReady, error } = Updater.updateInfo();
				if (!updateReady)
					throw new Error(error || "The update did not download");
				// Quits, replaces the app and relaunches it.
				await Updater.applyUpdate();
			} finally {
				Updater.onStatusChange(null);
			}
		},
	}),
} as const;
