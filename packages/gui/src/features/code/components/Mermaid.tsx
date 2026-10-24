import { useCallback, useMemo } from "react";
import Content, {
	type ContentFormats,
	type ContentFormatterFunction,
} from "#gui/core/components/Content.tsx";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import MermaidContent from "#gui/features/code/components/MermaidContent.tsx";
import { useMermaid } from "#gui/features/code/hooks/useMermaid.ts";

export default function Mermaid({
	code,
	streaming,
	...props
}: Parameters<typeof Content>[0] & {
	code: string;
	streaming?: boolean;
}) {
	const { mermaid } = useMermaid();

	const formats = useMemo<ContentFormats>(() => {
		return ["MMD", "SVG", "PNG"];
	}, []);

	const formatter = useCallback<ContentFormatterFunction>(
		async (format) => {
			if (format === "MMD") {
				return {
					extension: "mmd",
					mime: "text/plain",
					data: code,
				};
			} else {
				// Use a stable ID based on chart content hash and timestamp to ensure uniqueness
				const chartHash = code.split("").reduce((acc, char) => {
					return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
				}, 0);
				const uniqueId = `mermaid-${Math.abs(chartHash)}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

				const { svg } = await mermaid.render(uniqueId, code);
				if (!svg) throw new Error("failed to generate svg");

				if (format === "svg") {
					return {
						extension: "svg",
						mime: "image/svg+xml",
						data: svg,
					};
				}

				if (format === "png") {
					return {
						extension: "png",
						mime: "image/png",
						data: await ControlUtils.rasterize(svg),
					};
				}
			}
			throw new Error("invalid chart format");
		},
		[code, mermaid],
	);

	return (
		<Content
			formats={formats}
			formatter={formatter}
			streaming={streaming}
			findLabel="Diagram"
			data-streamdown="mermaid-block"
			data-language="mermaid"
			data-incomplete={streaming}
			{...props}
		>
			<div className="rounded-md border border-(--mantine-color-default-border) p-4 text-sm">
				<MermaidContent chart={code} />
			</div>
		</Content>
	);
}
