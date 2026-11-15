import { app } from "electron";
import electronUpdater from "electron-updater";
import type {
	DesktopHandlers,
	DesktopSend,
} from "#app-electron-plugin/core/types/plugin.ts";

export const UpdateHostService = {
	/**
	 * Updates to the whole app from the latest release, whose artifacts
	 * electron-builder's `publish` (`electron-builder.config.js`) names. Only
	 * a packaged app has one to compare itself with.
	 */
	create: ({
		send,
	}: {
		send: DesktopSend;
	}): DesktopHandlers<"updateCheck" | "updateInstall"> => {
		// CommonJS, whose named exports a bundle cannot see.
		const { autoUpdater } = electronUpdater;
		autoUpdater.autoDownload = false;
		autoUpdater.autoInstallOnAppQuit = false;

		return {
			updateCheck: async () => {
				if (!app.isPackaged) return null;
				const result = await autoUpdater.checkForUpdates();
				return result?.isUpdateAvailable
					? {
							version: result.updateInfo.version,
							date: result.updateInfo.releaseDate,
						}
					: null;
			},
			updateInstall: async () => {
				const onProgress = ({ percent }: { percent: number }) =>
					send.updateProgress({ fraction: percent / 100 });
				autoUpdater.on("download-progress", onProgress);
				try {
					await autoUpdater.downloadUpdate();
				} finally {
					autoUpdater.off("download-progress", onProgress);
				}
				// Quits, replaces the app and relaunches it.
				autoUpdater.quitAndInstall(false, true);
			},
		};
	},
} as const;
