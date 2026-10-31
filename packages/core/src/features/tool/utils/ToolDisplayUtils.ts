import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	zFileChanges,
	zFilePart,
} from "#core/features/data/types/part.ts";
import { FileExtractionService } from "#core/features/file/services/FileExtractionService.ts";
import { FileExcludeUtils } from "#core/features/file/utils/FileExcludeUtils.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { ToolBlock } from "#core/features/tool/types/display.ts";

/** Helpers tools use to describe their calls in `ToolBlock`s. */
export const ToolDisplayUtils = {
	/** The last segment of a path, safe on the partial input of a streaming call. */
	name: (path: string | undefined): string => {
		return path ? PathUtils.name(path) : "";
	},

	language: (path: string | undefined): string | undefined => {
		return path ? FileTypeUtils.getLanguage({ path }) : undefined;
	},

	date: (date: Date | string | null | undefined): string | undefined => {
		if (!date) return undefined;
		return CommonUtils.formatDate({ date: new Date(date), relative: true });
	},

	/** A file part as text, an image or a document, or nothing when it is none. */
	file: ({
		path,
		file,
	}: {
		path?: string;
		file: zFilePart;
	}): ToolBlock | undefined => {
		path ||= file.name ?? "";
		if (file.mime.startsWith("image/")) {
			return {
				type: "file",
				path,
				image: `data:${file.mime};base64,${file.data}`,
			};
		}
		if (
			FileExtractionService.canExtract({
				name: path ? PathUtils.name(path) : file.name,
				mime: file.mime,
			})
		) {
			return {
				type: "file",
				path,
				document: { data: file.data, mime: file.mime },
				language: "markdown",
			};
		}
		const content = FileUtils.getTextFromBytes(file);
		if (content === null) return undefined;
		return {
			type: "file",
			path,
			content,
			language: FileTypeUtils.getLanguage({ mime: file.mime, path }),
		};
	},

	/**
	 * Files a call changed, as diffs, and one line naming those with nothing
	 * to show: lockfiles, generated or binary files, and any past the limits.
	 */
	changes: (changes: zFileChanges | undefined): ToolBlock[] => {
		if (!changes?.files.length) return [];
		const blocks: ToolBlock[] = [];
		const names: string[] = [];
		for (const file of changes.files) {
			if (file.skipped) {
				const reason =
					file.skipped in FileExcludeUtils.reasons
						? FileExcludeUtils.reasons[
								file.skipped as keyof typeof FileExcludeUtils.reasons
							]
						: undefined;
				names.push(
					reason
						? `${ToolDisplayUtils.name(file.path)} (${reason})`
						: ToolDisplayUtils.name(file.path),
				);
				continue;
			}
			blocks.push({
				type: "diff",
				path: file.path,
				before: file.before ?? "",
				after: file.after ?? "",
				language: ToolDisplayUtils.language(file.path),
			});
		}
		if (changes.omitted)
			names.push(
				`${changes.omitted} more ${changes.omitted === 1 ? "file" : "files"}`,
			);
		if (names.length)
			blocks.push({
				type: "text",
				value: `${blocks.length ? "Also changed" : "Changed"} ${names.join(", ")}`,
				tone: "dimmed",
			});
		return blocks;
	},

	/** Text content for a file, typed as it is being streamed in. */
	text: ({
		path,
		content,
	}: {
		path: string | undefined;
		content: string | undefined;
	}): ToolBlock => {
		return {
			type: "file",
			path: path ?? "",
			content: content ?? "",
			language: ToolDisplayUtils.language(path),
		};
	},
} as const;
