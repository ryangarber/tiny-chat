import type { MarkItDown } from "@ryangarber/markitdown-ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/**
 * FileExtractionService — reads the formats that carry text without storing it
 * as text.
 *
 * A PDF, a Word document and a spreadsheet are all containers: the words are in
 * there, but not as bytes anything can decode. Uploads keep such a file exactly
 * as it arrived, so the unpacking happens here instead, at the moment something
 * needs to read one — a search deciding whether a document matches, or a
 * preview deciding what to show.
 *
 * Extracting at read time rather than at upload time is what keeps the original
 * file the original file. The same bytes go to a model that accepts PDFs
 * natively, download gives back the document that was sent, and improving the
 * converter improves every document already stored rather than only the next
 * one.
 *
 * The converters are large and almost never needed in a given session, so they
 * are imported on first use rather than at module load.
 */

/** Formats with a converter behind them. Everything else stays bytes. */
const FORMATS = new Set(["pdf", "docx", "xlsx"]);

/** Bytes past which a document is left unopened, whatever it is. */
const MAX_BYTES = 25_000_000;

/** Documents held in memory. A preview and a search read the same few files. */
const MAX_CACHED = 32;

const cache = new Map<string, string | null>();

let engine: Promise<MarkItDown> | undefined;

const getEngine = () => {
	engine ??= import("@ryangarber/markitdown-ts").then(
		({ MarkItDown }) => new MarkItDown(),
	);
	return engine;
};

/**
 * A key that changes when the document does. Sampled rather than complete: a
 * full hash of twenty megabytes costs more than the lookup saves, and a length
 * plus both ends of a container format does not collide in practice.
 */
const getKey = ({ data, format }: { data: Uint8Array; format: string }) => {
	let hash = 0x811c9dc5;

	const sample = (from: number, to: number) => {
		for (let index = from; index < to; index++) {
			hash = Math.imul(hash ^ data[index], 0x01000193);
		}
	};

	sample(0, Math.min(data.length, 4_096));
	sample(Math.max(0, data.length - 4_096), data.length);

	return `${format}:${data.length}:${(hash >>> 0).toString(36)}`;
};

const getSuffix = (name: string) => {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const FileExtractionService = {
	formats: FORMATS as ReadonlySet<string>,
	maxBytes: MAX_BYTES,

	/**
	 * The extractable format a file is in, or null when it is not in one.
	 *
	 * The name is asked first and the mime type only as a fallback, because a
	 * mime type is often a guess from the same bytes we are about to unpack —
	 * and a wrong guess of `application/octet-stream` would otherwise read as
	 * an extension of its own.
	 */
	getFormat: ({
		path,
		name,
		mime,
	}: {
		path?: string[] | string;
		name?: string;
		mime?: string;
	}): string | null => {
		const named = getSuffix(path ? PathUtils.name({ path }) : (name ?? ""));
		if (FORMATS.has(named)) return named;

		const typed = mime
			? (FileTypeUtils.mime.getExtension(mime) ?? "")
			: undefined;
		return typed && FORMATS.has(typed) ? typed : null;
	},

	canExtract: (source: {
		path?: string[] | string;
		name?: string;
		mime?: string;
	}): boolean => FileExtractionService.getFormat(source) !== null,

	/**
	 * Markdown for a document, or null when there is nothing to extract.
	 *
	 * A document that cannot be opened — encrypted, truncated, or not the
	 * format its name claims — is also null rather than a throw. That is a fact
	 * about one file, and a search that walked into it should carry on.
	 */
	extract: async ({
		data,
		path,
		name,
		mime,
	}: {
		data: Uint8Array;
		path?: string[] | string;
		name?: string;
		mime?: string;
	}): Promise<string | null> => {
		const format = FileExtractionService.getFormat({ path, name, mime });
		if (!format || !data.length || data.length > MAX_BYTES) return null;

		const key = getKey({ data, format });
		if (cache.has(key)) {
			const cached = cache.get(key) ?? null;
			// Re-inserted so the least recently read document is the one dropped.
			cache.delete(key);
			cache.set(key, cached);
			return cached;
		}

		let markdown: string | null = null;
		try {
			const result = await (await getEngine()).convert(data, {
				extension: format,
			});
			markdown = result?.markdown.trim() || null;
		} catch (error) {
			console.warn(
				`[FileExtractionService] could not read ${format}: ${path ?? name ?? "document"}`,
				error,
			);
		}

		cache.set(key, markdown);
		if (cache.size > MAX_CACHED) {
			const oldest = cache.keys().next();
			if (!oldest.done) cache.delete(oldest.value);
		}

		return markdown;
	},
} as const;
