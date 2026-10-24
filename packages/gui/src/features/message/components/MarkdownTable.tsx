import { Box, type BoxProps } from "@mantine/core";
import { type HTMLAttributes, useCallback, useMemo, useRef } from "react";
import {
	extractTableDataFromElement,
	tableDataToCSV,
	tableDataToMarkdown,
	tableDataToTSV,
} from "streamdown";
import Content, {
	type ContentFormats,
	type ContentFormatterFunction,
} from "#gui/core/components/Content.tsx";

type TableFormats = "Markdown" | "HTML" | "CSV" | "TSV";

export const Table = ({
	children,
	className,
	withButtons,
	streaming,
	...props
}: HTMLAttributes<HTMLDivElement> &
	BoxProps & {
		with?: boolean;
		withButtons?: boolean;
		streaming?: boolean;
	}) => {
	const insideRef = useRef<HTMLDivElement>(null);

	const formats = useMemo<ContentFormats<TableFormats>>(() => {
		return ["Markdown", "HTML", "CSV", "TSV"];
	}, []);

	const formatter = useCallback<ContentFormatterFunction<TableFormats>>(
		(format) => {
			const tableWrapper = insideRef.current?.closest(
				'[data-streamdown="table-wrapper"]',
			);
			const tableElement = tableWrapper?.querySelector(
				"table",
			) as HTMLTableElement;

			if (!tableElement) {
				throw new Error("missing table");
			}

			const tableData = extractTableDataFromElement(tableElement);

			if (format === "Markdown") {
				return {
					extension: "md",
					mime: "text/plain",
					data: tableDataToMarkdown(tableData),
				};
			} else if (format === "HTML") {
				return {
					extension: "html",
					mime: "text/html",
					data: tableElement.outerHTML,
				};
			} else if (format === "CSV") {
				return {
					extension: "csv",
					mime: "text/plain",
					data: tableDataToCSV(tableData),
				};
			} else if (format === "TSV") {
				return {
					extension: "tsv",
					mime: "text/plain",
					data: tableDataToTSV(tableData),
				};
			}

			throw new Error("invalid table format");
		},
		[],
	);

	return (
		<Content
			ref={insideRef}
			formats={formats}
			formatter={formatter}
			streaming={streaming}
			findLabel="Table"
			data-streamdown="table-wrapper"
		>
			<Box
				className="border-collapse overflow-x-auto overflow-y-auto rounded-md border border-border"
				{...props}
			>
				<table
					className="w-full *:divide-none [&_th]:first:ps-6 [&_th]:last:pe-6 [&_td]:first:ps-6 [&_td]:last:pe-6 [&_th]:py-3 [&_td]:py-4"
					data-streamdown="table"
				>
					{children}
				</table>
			</Box>
		</Content>
	);
};
