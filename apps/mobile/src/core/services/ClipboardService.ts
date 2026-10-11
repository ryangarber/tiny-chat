import { Clipboard } from "@capacitor/clipboard";

/**
 * The system clipboard through `@capacitor/clipboard`, which WKWebView's own
 * clipboard is not: that one only writes during a click, and is missing
 * altogether while the dev server is loaded over plain HTTP.
 */
export const ClipboardService = {
	copy: async ({ mime, data }: { mime: string; data: Blob }) => {
		// The plugin takes text or a raster image; anything else goes as text.
		if (mime.startsWith("image/") && !mime.startsWith("image/svg")) {
			const image = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as string);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(data);
			});
			await Clipboard.write({ image });
		} else {
			await Clipboard.write({ string: await data.text() });
		}
	},
} as const;
