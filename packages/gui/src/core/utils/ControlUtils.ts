import type { KeyboardEvent } from "react";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import type { ClientRuntime } from "#gui/core/types/runtime.ts";

export const ControlUtils = {
	/**
	 * Saves a single-field editor on Enter. Shift+Enter still breaks a line in
	 * a textarea, and Enter that closes an IME composition is left alone.
	 */
	onEnter:
		(save: () => void) =>
		(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			if (event.key !== "Enter" || event.shiftKey) return;
			if (event.nativeEvent.isComposing) return;
			event.preventDefault();
			save();
		},

	preprocess: ({ data, mime }: { data: string | Blob; mime: string }) => {
		// Prepend UTF-8 BOM for CSV so Excel on Windows correctly detects the encoding.
		// Without it, Excel falls back to the system ANSI codepage and corrupts non-ASCII text.
		const bom =
			typeof data === "string" && mime.startsWith("text/csv") ? "\uFEFF" : "";
		return typeof data === "string"
			? new Blob([bom + data], { type: mime })
			: data;
	},

	copy: async ({
		runtime,
		filename,
		data,
		mime,
	}: {
		runtime: ClientRuntime;
		filename?: string;
		data: string | Blob;
		mime?: string;
	}) => {
		mime ??= await FileTypeUtils.getMime({ path: filename, data });

		data = ControlUtils.preprocess({ data, mime });
		if (runtime.copy) return runtime.copy({ mime, data });

		await navigator.clipboard.write([
			new ClipboardItem({
				...{ [mime]: data },
			}),
		]);
	},

	download: async ({
		filename,
		extension,
		data,
		mime,
	}: {
		filename?: string;
		extension?: string;
		mime?: string;
		data: string | Blob;
	}) => {
		let prefix = filename?.split("/").at(-1);

		if (!prefix?.includes("."))
			prefix = `tiny-chat-${Temporal.Now.zonedDateTimeISO().toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`;
		else prefix = prefix.replace(/\.[A-Za-z0-9]+$/, "");

		extension ??= FileTypeUtils.getExtension({ name: filename }) ?? "txt";
		mime ??= await FileTypeUtils.getMime({ path: filename, data });

		data = ControlUtils.preprocess({ data, mime });
		const url = URL.createObjectURL(data);

		const a = document.createElement("a");
		a.href = url;
		a.download = `${prefix}.${extension}`;
		document.body.appendChild(a);

		a.click();

		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	},

	/**
	 * Convert SVG string to PNG blob for export
	 */
	rasterize: (
		svgString: string,
		options?: { scale?: number },
	): Promise<Blob> => {
		const scale = options?.scale ?? 5;

		return new Promise((resolve, reject) => {
			const encoded = `data:image/svg+xml;base64,${FileUtils.getBase64FromText({ text: svgString })}`;
			console.log(encoded);

			const img = new Image();
			img.crossOrigin = "anonymous";

			img.onload = () => {
				const canvas = document.createElement("canvas");
				const w = img.width * scale;
				const h = img.height * scale;

				canvas.width = w;
				canvas.height = h;

				const ctx = canvas.getContext("2d");

				if (!ctx) {
					reject(
						new Error("Failed to create 2D canvas context for PNG export"),
					);
					return;
				}

				// Do NOT draw a background → transparency preserved
				// ctx.clearRect(0, 0, w, h);

				ctx.drawImage(img, 0, 0, w, h);

				// Export PNG (lossless, keeps transparency)
				canvas.toBlob((blob) => {
					if (!blob) {
						reject(new Error("Failed to create PNG blob"));
						return;
					}
					resolve(blob);
				}, "image/png");
			};

			img.onerror = () => reject(new Error("Failed to load SVG image"));
			img.src = encoded;
		});
	},
} as const;
