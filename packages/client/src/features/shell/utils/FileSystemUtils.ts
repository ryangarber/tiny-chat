import type { Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Directories read at once while walking a tree. */
const WALK_CONCURRENCY = 32;

/** Files open at once while reading several. */
const READ_CONCURRENCY = 32;

/** `ShellCapability` file system calls over Node's, for `NodeShellService`. */
export const FileSystemUtils = {
	/**
	 * `ShellCapability.walk`: breadth-first, one level at a time, with each
	 * level's directories read concurrently. Order is the same as reading them
	 * one by one — each directory's entries sorted, directories in the order
	 * they were found.
	 */
	walk: async ({
		path,
		maxDepth,
		maxEntries,
		prune,
	}: {
		path: string;
		maxDepth: number;
		maxEntries: number;
		prune: string[];
	}) => {
		const pruned = new Set(prune);
		const entries: { path: string; is_dir: boolean }[] = [];
		let truncated = false;

		// A missing root is a real error; an unreadable subdirectory is not.
		let level: { path: string; listing: Dirent[] }[] = [
			{ path, listing: await readdir(path, { withFileTypes: true }) },
		];

		for (let depth = 0; level.length; depth++) {
			const next: string[] = [];

			for (const directory of level) {
				const listing = directory.listing
					.map((entry) => ({
						path: join(directory.path, entry.name),
						name: entry.name,
						is_dir: entry.isDirectory(),
					}))
					.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

				for (const entry of listing) {
					if (entries.length >= maxEntries)
						return { root: path, entries, truncated: true };

					entries.push({ path: entry.path, is_dir: entry.is_dir });
					if (!entry.is_dir || pruned.has(entry.name.toLowerCase())) continue;
					if (depth + 1 > maxDepth) truncated = true;
					else next.push(entry.path);
				}
			}

			level = [];
			for (let index = 0; index < next.length; index += WALK_CONCURRENCY) {
				const batch = await Promise.all(
					next.slice(index, index + WALK_CONCURRENCY).map(async (path) => ({
						path,
						listing: await readdir(path, { withFileTypes: true }).catch(
							() => [] as Dirent[],
						),
					})),
				);
				level.push(...batch);
			}
		}

		return { root: path, entries, truncated };
	},

	/**
	 * `ShellCapability.readFiles`: at most `maxBytes` of each file, a few at a
	 * time, with a file that cannot be read left as null.
	 */
	readFiles: async ({
		paths,
		maxBytes,
	}: {
		paths: string[];
		maxBytes: number;
	}) => {
		const read = async (path: string) => {
			const file = await open(path, "r");
			try {
				const { size } = await file.stat();
				const data = new Uint8Array(Math.min(size, maxBytes));
				const { bytesRead } = await file.read(data, 0, data.length, 0);
				return { data: data.subarray(0, bytesRead), size };
			} finally {
				await file.close();
			}
		};

		const results: ({ data: Uint8Array; size: number } | null)[] = [];
		for (let index = 0; index < paths.length; index += READ_CONCURRENCY) {
			const batch = await Promise.all(
				paths
					.slice(index, index + READ_CONCURRENCY)
					.map((path) => read(path).catch(() => null)),
			);
			results.push(...batch);
		}
		return results;
	},
} as const;
