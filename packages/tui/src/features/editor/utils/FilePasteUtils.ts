import { existsSync, lstatSync } from "node:fs";
import { TuiUtils } from "#tui/core/utils/TuiUtils.ts";

/** A run of the pasted text that is not a raw, unescaped space. */
const TOKEN = /(?:\\.|[^\s\\])+/g;

export type FilePaste = { path: string; directory: boolean };

/**
 * A file dropped onto a macOS terminal (Terminal.app, iTerm2, …) does not
 * arrive as a paste of its contents: it arrives as its absolute path, with
 * every character a shell would treat specially escaped by a backslash, and a
 * trailing space after it — one run per file, for as many as were dropped
 * together.
 *
 * Detected only once every run unescapes to a path that actually exists, so
 * an ordinary sentence that happens to start with a slash is never mistaken
 * for one.
 */
export const FilePasteUtils = {
	detect: (text: string): FilePaste[] | null => {
		if (!text.endsWith(" ") || text.startsWith(" ") || text.includes("\n")) {
			return null;
		}

		const body = text.slice(0, -1);
		const tokens = body.match(TOKEN);
		if (!tokens || tokens.join(" ") !== body) return null;

		const files: FilePaste[] = [];

		for (const token of tokens) {
			const unescaped = token.replace(/\\(.)/g, "$1");
			if (!unescaped.startsWith("/") && !unescaped.startsWith("~")) {
				return null;
			}

			const resolved = TuiUtils.resolve(unescaped);
			if (!existsSync(resolved)) return null;

			files.push({
				path: resolved,
				directory: lstatSync(resolved).isDirectory(),
			});
		}

		return files;
	},
} as const;
