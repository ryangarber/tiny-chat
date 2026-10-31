import { useQuery } from "@tanstack/react-query";
import { FileExtractionService } from "#core/features/file/services/FileExtractionService.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/**
 * A document's text (a PDF, Word document or spreadsheet a tool read), as
 * Markdown. Null when it has none to give: encrypted, scanned or damaged.
 */
export const useDocument = ({
	path,
	document,
}: {
	path: string;
	document: { data: string; mime: string };
}) => {
	return useQuery({
		// Sampled, as a whole document would be hashed on every render; the
		// service keys its own cache on the bytes.
		queryKey: [
			"useDocument",
			path,
			document.mime,
			document.data.length,
			document.data.slice(0, 64),
			document.data.slice(-64),
		],
		queryFn: async () =>
			FileExtractionService.extract({
				data: FileUtils.getBufferFromBytes({ data: document.data }),
				name: path ? PathUtils.name(path) : undefined,
				mime: document.mime,
			}),
		staleTime: Number.POSITIVE_INFINITY,
	});
};
