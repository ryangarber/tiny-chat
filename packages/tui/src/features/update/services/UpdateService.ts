import { createWriteStream } from "node:fs";
import { chmod, rename, rm, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import workspace from "../../../../../../package.json" with { type: "json" };

/** where every platform's build of a release is published */
const RELEASE =
	"https://github.com/RyanGarber/tiny-chat/releases/latest/download";

/** the asset each platform's binary is published as, named by release-cli.yml */
const ASSETS: Partial<Record<NodeJS.Platform, string>> = {
	darwin: "Tiny.Chat_CLI_macOS",
	linux: "Tiny.Chat_CLI_Linux",
	win32: "Tiny.Chat_CLI_Windows.exe",
};

export const UpdateService = {
	version: workspace.version,

	/**
	 * The compiled binary this process is running from, which is the only build
	 * that can be replaced in place — one run from source runs out of `node` or
	 * `bun` itself, which is not ours to overwrite.
	 */
	binary: (): string | null => {
		if (!process.versions.bun) return null;
		if (!ASSETS[process.platform]) return null;

		const name = basename(process.execPath, ".exe").toLowerCase();
		if (name === "bun" || name === "bun-debug") return null;

		return process.execPath;
	},

	/** The released version, if it is a release after the one running. */
	check: async (): Promise<string | null> => {
		const response = await fetch(`${RELEASE}/latest.json`, {
			headers: { accept: "application/json" },
		});
		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}

		const { version } = (await response.json()) as { version?: string };
		if (!version) throw new Error("no version in latest.json");

		return UpdateService.isNewer(version, UpdateService.version)
			? version
			: null;
	},

	/** Whether one version is a release after another, by its numbers alone. */
	isNewer: (version: string, than: string): boolean => {
		const numbers = (value: string) =>
			value
				.split(/[-+]/)[0]
				.split(".")
				.map((part) => Number.parseInt(part, 10) || 0);

		const a = numbers(version);
		const b = numbers(than);

		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const difference = (a[i] ?? 0) - (b[i] ?? 0);
			if (difference !== 0) return difference > 0;
		}

		return false;
	},

	/**
	 * Replaces the running binary with the released one. The download lands
	 * beside it so that the move onto it stays within one file system, where a
	 * rename either replaces the file whole or leaves it untouched — the running
	 * process holds on to the file it started from either way, so the new build
	 * is the one the next run starts from.
	 */
	install: async ({
		onProgress,
	}: {
		onProgress?: (progress: number | null) => void;
	} = {}): Promise<void> => {
		const binary = UpdateService.binary();
		const asset = ASSETS[process.platform];
		if (!binary || !asset) throw new Error("this build cannot update itself");

		const response = await fetch(`${RELEASE}/${asset}`);
		if (!response.ok || !response.body) {
			throw new Error(`${response.status} ${response.statusText}`);
		}

		const total = Number(response.headers.get("content-length")) || 0;
		let current = 0;

		const download = `${binary}.download`;
		const previous = `${binary}.old`;

		try {
			const stream = Readable.fromWeb(
				response.body as ReadableStream<Uint8Array>,
			);
			stream.on("data", (chunk: Buffer) => {
				current += chunk.length;
				onProgress?.(total ? current / total : null);
			});

			await pipeline(stream, createWriteStream(download));

			// Whatever the binary was reachable as, the replacement is reachable
			// as, rather than whatever the download happened to land as.
			await chmod(download, (await stat(binary)).mode);

			if (process.platform === "win32") {
				// A running file cannot be replaced on Windows, but it can be
				// moved aside — and taken out on the next check, by which time
				// nothing is running from it.
				await rm(previous, { force: true }).catch(() => {});
				await rename(binary, previous);
				try {
					await rename(download, binary);
				} catch (error) {
					await rename(previous, binary);
					throw error;
				}
			} else {
				await rename(download, binary);
			}
		} catch (error) {
			await rm(download, { force: true }).catch(() => {});
			throw error;
		}
	},

	/** Takes out what an interrupted or a Windows install left behind. */
	clean: async (): Promise<void> => {
		const binary = UpdateService.binary();
		if (!binary) return;

		await rm(`${binary}.download`, { force: true }).catch(() => {});
		await rm(`${binary}.old`, { force: true }).catch(() => {});
	},
};
