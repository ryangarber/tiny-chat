import { Box } from "@mantine/core";
import type { ComponentProps } from "react";
import { type AnimateOptions, Streamdown } from "streamdown";
import { StreamContext } from "#client/features/message/components/StreamContext.tsx";
import {
	type MarkdownSource,
	useMarkdown,
} from "#client/features/message/hooks/useMarkdown.ts";
import { useMarkdownBlocks } from "#client/features/message/hooks/useMarkdownBlocks.ts";
import ErrorBoundary from "#gui/core/components/ErrorBoundary.tsx";
import { MarkdownComponents } from "#gui/features/message/components/MarkdownComponents.tsx";
import "katex/dist/katex.min.css";

const animated: AnimateOptions = {
	animation: "blurIn",
	duration: 150,
	easing: "ease",
	stagger: 5,
	sep: "word",
};

/**
 * One top-level markdown block.
 *
 * Streamdown's own memo bails out when `children` is unchanged, so a block that
 * has scrolled off the tail of the stream costs nothing on later tokens: no
 * remend pass, no lexer pass, no React walk.
 */
function MarkdownBlock({
	source,
	streaming,
	animating,
	remarkPlugins,
	rehypePlugins,
}: {
	source: string;
	streaming: boolean;
	animating: boolean;
	remarkPlugins: ComponentProps<typeof Streamdown>["remarkPlugins"];
	rehypePlugins: ComponentProps<typeof Streamdown>["rehypePlugins"];
}) {
	return (
		<Streamdown
			animated={animated}
			isAnimating={animating}
			mode={streaming ? "streaming" : "static"}
			components={MarkdownComponents}
			remarkPlugins={remarkPlugins}
			rehypePlugins={rehypePlugins}
			className="selectable"
		>
			{source}
		</Streamdown>
	);
}

export default function Markdown({
	source,
	streaming = false,
}: {
	source: MarkdownSource;
	streaming?: boolean;
}) {
	const { remarkPlugins, rehypePlugins, content } = useMarkdown({
		source,
		withKatex: true,
	});

	/**
	 * Split once here rather than letting a single Streamdown instance do it
	 * internally. Feeding it the whole document meant every token re-ran
	 * remend and the marked lexer over everything already on screen and walked
	 * the full block list, which is what made per-token cost grow with message
	 * length.
	 *
	 * The split is the one the CLI makes, by the parser the blocks are rendered
	 * with — Streamdown's own splitter knows nothing of directives, and cut a
	 * container one into an empty block, its contents, and a stray `:::`. Each
	 * Streamdown closes what a stream left open in its own block.
	 */
	const blocks = useMarkdownBlocks({ content });

	return (
		<StreamContext value={streaming}>
			<Box className="space-y-4 wrap-break-word">
				{blocks.map((block, index) => (
					<ErrorBoundary
						// biome-ignore lint/suspicious/noArrayIndexKey: blocks stay in order
						key={index}
						label="this markdown"
						resetKey={block}
					>
						<MarkdownBlock
							source={block}
							streaming={streaming}
							animating={streaming && index === blocks.length - 1}
							remarkPlugins={remarkPlugins}
							rehypePlugins={rehypePlugins}
						/>
					</ErrorBoundary>
				))}
			</Box>
		</StreamContext>
	);
}
