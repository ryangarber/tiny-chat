import {
	getFiles,
	getImageBinary,
	getText,
	hasFiles,
	hasImage,
	hasText,
	setImageBinary,
	setText,
} from "@crosscopy/clipboard";
import { TuiUtils } from "#tui/core/utils/TuiUtils.ts";

/** What the clipboard was holding when it was read. */
export type ClipboardContent =
	| { type: "files"; paths: string[] }
	| { type: "text"; text: string }
	| { type: "image"; data: Uint8Array<ArrayBuffer> }
	| null;

/**
 * The system clipboard, which the terminal only half gives access to.
 *
 * A paste arrives on stdin as text and nothing else: an image on the clipboard
 * is dropped by the terminal before the program ever sees it. Reading the
 * clipboard directly is the only way to reach one, so it is read here rather
 * than waited for — and every call is guarded, since a machine may have no
 * clipboard to reach at all.
 */
export const ClipboardService = {
	/**
	 * Hands plain text to the clipboard, removing terminal escape sequences.
	 * Nothing to fall back on where the system has no clipboard to write to.
	 */
	copy: (text: string) => {
		if (!text) return;
		setText(TuiUtils.plain(text)).catch((error) => {
			console.warn("[ClipboardService] failed to copy", error);
		});
	},

	/** Hands an encoded image (PNG, JPEG, …) to the clipboard. */
	copyImage: (data: Uint8Array) => {
		if (!data.length) return;
		setImageBinary(Array.from(data)).catch((error) => {
			console.warn("[ClipboardService] failed to copy image", error);
		});
	},

	/**
	 * What the clipboard is holding: files ahead of an image, and an image ahead
	 * of text. A file copied in Finder carries its icon as an image and its name
	 * as text alongside the file itself, so either alone would attach the wrong
	 * thing; a screenshot copied on macOS likewise carries its file name as text.
	 */
	read: async (): Promise<ClipboardContent> => {
		try {
			if (hasFiles()) {
				const paths = (await getFiles()).filter(Boolean);
				if (paths.length) return { type: "files", paths };
			}
			if (hasImage()) {
				return { type: "image", data: Uint8Array.from(await getImageBinary()) };
			}
			if (hasText()) {
				return { type: "text", text: await getText() };
			}
		} catch (error) {
			console.warn("[ClipboardService] failed to read", error);
		}

		return null;
	},
} as const;
