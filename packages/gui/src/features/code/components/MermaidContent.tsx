/** @author https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/mermaid/index.tsx */

import { Loader, UnstyledButton } from "@mantine/core";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import Code from "#gui/features/code/components/Code.tsx";
import { useDeferredRender } from "#gui/features/code/hooks/useDeferredRenderer.ts";
import { useMermaid } from "#gui/features/code/hooks/useMermaid.ts";

export default function MermaidContent({ chart }: { chart: string }) {
	const { mermaid } = useMermaid();

	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [svgContent, setSvgContent] = useState<string>("");
	const [lastValidSvg, setLastValidSvg] = useState<string>("");
	const [retryCount, setRetryCount] = useState(0);

	// Use deferred render hook for optimal performance
	const { shouldRender, containerRef } = useDeferredRender();

	// biome-ignore lint/correctness/useExhaustiveDependencies: "Required for Mermaid"
	useEffect(() => {
		// Only render when shouldRender is true
		if (!shouldRender) {
			return;
		}

		const renderChart = async () => {
			try {
				setError(null);
				setIsLoading(true);

				// Use a stable ID based on chart content hash and timestamp to ensure uniqueness
				const chartHash = chart.split("").reduce((acc, char) => {
					return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
				}, 0);
				const uniqueId = `mermaid-${Math.abs(chartHash)}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

				const { svg } = await mermaid.render(uniqueId, chart);

				// Update both current and last valid SVG
				setSvgContent(svg);
				setLastValidSvg(svg);
			} catch (err) {
				// Silently fail and keep the last valid SVG
				// Don't update svgContent here - just keep what we have

				// Only set error if we don't have any valid SVG
				if (!(lastValidSvg || svgContent)) {
					const errorMessage =
						err instanceof Error
							? err.message
							: "Failed to render Mermaid chart";
					setError(errorMessage);
				}
			} finally {
				setIsLoading(false);
			}
		};

		void renderChart();
	}, [chart, retryCount, shouldRender]);

	// Show placeholder when not scheduled to render
	if (!(shouldRender || svgContent || lastValidSvg)) {
		return <div className="my-4 min-h-50" ref={containerRef} />;
	}

	if (isLoading && !svgContent && !lastValidSvg) {
		return (
			<div className="my-4 flex justify-center p-4" ref={containerRef}>
				<div className="flex items-center space-x-2 text-muted-foreground">
					<div className="h-4 w-4 animate-spin rounded-full border-current border-b-2" />
					<Loader size="sm" />
				</div>
			</div>
		);
	}

	// Only show error if we have no valid SVG to display
	if (error && !svgContent && !lastValidSvg) {
		return (
			<div className="rounded-md p-4" ref={containerRef}>
				<p className="font-mono text-red-700 text-sm">Mermaid Error: {error}</p>
				<UnstyledButton
					mt={5}
					className="cursor-pointer text-xs"
					onClick={(e) => {
						e.preventDefault();
						setRetryCount(retryCount + 1);
					}}
				>
					<ArrowClockwiseIcon size={12} className="mr-1 inline-block" />
					Retry
				</UnstyledButton>
				<details>
					<summary className="cursor-pointer text-xs">Show Code</summary>
					<Code code={chart} language="mermaid" mt={10} />
				</details>
			</div>
		);
	}

	// Always render the SVG if we have content (either current or last valid)
	const displaySvg = svgContent || lastValidSvg;

	return (
		<div className="size-full" data-streamdown="mermaid" ref={containerRef}>
			<div
				aria-label="Mermaid chart"
				className="flex justify-center"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: "Required for Mermaid"
				dangerouslySetInnerHTML={{ __html: displaySvg }}
				role="img"
			/>
		</div>
	);
}
