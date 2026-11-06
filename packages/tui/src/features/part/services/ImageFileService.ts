import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

export type ImageSource = string | Uint8Array | ArrayBuffer;

const EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/bmp": "bmp",
	"image/avif": "avif",
	"image/tiff": "tiff",
};

/** The extension of an encoded image, from its first bytes. */
const sniff = (bytes: Uint8Array) => {
	const hex = Buffer.from(bytes.subarray(0, 12)).toString("hex");
	if (hex.startsWith("89504e47")) return "png";
	if (hex.startsWith("ffd8ff")) return "jpg";
	if (hex.startsWith("47494638")) return "gif";
	if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250")
		return "webp";
	return "png";
};

const DIRECTORY = join(tmpdir(), "tiny-chat", "images");

/** Writes `bytes` once under the temp directory, named by its contents. */
const materialize = async (bytes: Uint8Array, extension?: string) => {
	const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
	const path = join(DIRECTORY, `${hash}.${extension ?? sniff(bytes)}`);
	if (!existsSync(path)) {
		await mkdir(DIRECTORY, { recursive: true });
		await writeFile(path, bytes);
	}
	return pathToFileURL(path).href;
};

const locate = async (src: ImageSource, path?: string): Promise<string> => {
	if (path && isAbsolute(path) && existsSync(path)) {
		return pathToFileURL(path).href;
	}
	if (typeof src !== "string") {
		return materialize(src instanceof Uint8Array ? src : new Uint8Array(src));
	}
	const data = /^data:([^;,]*)(;base64)?,/i.exec(src);
	if (data) {
		const body = src.slice(data[0].length);
		const bytes = data[2]
			? Buffer.from(body, "base64")
			: Buffer.from(decodeURIComponent(body));
		return materialize(bytes, EXTENSIONS[data[1]?.toLowerCase() ?? ""]);
	}
	if (isAbsolute(src) && existsSync(src)) return pathToFileURL(src).href;
	return src;
};

/** Each source's URL, kept so a screenshot drawn again is not written again. */
const cache = new Map<ImageSource, Promise<string>>();
const CACHE_SIZE = 64;

/**
 * Where an image can be opened from outside the terminal: its file when it
 * has one, its URL when it is remote, and otherwise a temp file written from
 * its data — a data URL is far too long for a terminal link to carry.
 */
export const ImageFileService = {
	url: (src: ImageSource, path?: string): Promise<string> => {
		const key = path ?? src;
		let url = cache.get(key);
		if (!url) {
			url = locate(src, path);
			url.catch(() => cache.delete(key));
			cache.set(key, url);
			if (cache.size > CACHE_SIZE) {
				cache.delete(cache.keys().next().value as ImageSource);
			}
		}
		return url;
	},
} as const;
