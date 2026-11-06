import { JsonTree } from "@gfazioli/mantine-json-tree";
import { Anchor, Box, Stack, Text } from "@mantine/core";
import type { AgentStreamEvent } from "#client/core/services/StreamService.ts";
import { ChatService } from "#client/features/chat/services/ChatService.ts";
import { useDocument } from "#client/features/part/hooks/useDocument.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { ToolBlock as ToolBlockType } from "#core/features/tool/types/display.ts";
import ErrorBoundary from "#gui/core/components/ErrorBoundary.tsx";
import Code from "#gui/features/code/components/Code.tsx";
import Diff from "#gui/features/code/components/Diff.tsx";
import Markdown from "#gui/features/message/components/Markdown.tsx";
import MessageParts from "#gui/features/message/components/MessageParts.tsx";
import Image from "#gui/features/part/components/Image.tsx";
import Quote from "#gui/features/part/components/Quote.tsx";
import Tail from "#gui/features/part/components/Tail.tsx";
import Web from "#gui/features/part/components/Web.tsx";

/** Height a block is held to while it grows, following its newest lines. */
const TAIL_HEIGHT = 320;

/** A path shown relative to the directory it was listed from. */
const relative = (root: string, path: string) => {
	const base = PathUtils.normalize({ path: root, unix: true }).replace(
		/\/$/,
		"",
	);
	const normalized = PathUtils.normalize({ path, unix: true });
	return normalized.startsWith(`${base}/`)
		? normalized.slice(base.length + 1)
		: normalized;
};

/** A document's extracted text, read once it is shown. */
function Document({
	path,
	document,
}: {
	path: string;
	document: { data: string; mime: string };
}) {
	const { data, isPending } = useDocument({ path, document });
	if (isPending || !data) {
		return (
			<Text size="sm" c="dimmed">
				{isPending
					? `Reading ${(path && PathUtils.name(path)) || "document"}…`
					: `No text could be read from ${(path && PathUtils.name(path)) || "this document"}`}
			</Text>
		);
	}
	return (
		<Tail height={TAIL_HEIGHT} follow={false} content={data}>
			<Code code={data} language="markdown" filename={path} />
		</Tail>
	);
}

type ToolBlockProps = {
	block: ToolBlockType;
	/** Whether the call is still streaming or running. */
	active: boolean;
};

/** Each block on its own, so one that fails to draw leaves the rest of the call. */
export default function ToolBlock(props: ToolBlockProps) {
	return (
		<ErrorBoundary label={`this ${props.block.type}`} resetKey={props.block}>
			<ToolBlockBody {...props} />
		</ErrorBoundary>
	);
}

/**
 * Draws one piece of tool content. This is the whole of the app's knowledge
 * of tools: each tool describes itself in these blocks, so a new tool needs no
 * code here.
 */
function ToolBlockBody({ block, active }: ToolBlockProps) {
	switch (block.type) {
		case "text":
			return (
				<Text
					size="sm"
					c={
						block.tone === "error"
							? "red"
							: block.tone === "dimmed"
								? "dimmed"
								: undefined
					}
					style={{ whiteSpace: "pre-wrap" }}
				>
					{block.value}
				</Text>
			);
		case "markdown": {
			const markdown = <Markdown source={block.value} streaming={active} />;
			return block.quote ? (
				<Quote className="my-0!">{markdown}</Quote>
			) : (
				markdown
			);
		}
		case "code":
			return (
				<Tail
					height={TAIL_HEIGHT}
					follow={active || !!block.terminal}
					content={block.value}
				>
					<Code
						code={block.value}
						language={block.language}
						filename={block.title}
						lineNumbers={!block.terminal}
						streaming={active}
					/>
				</Tail>
			);
		case "file":
			if (block.image) {
				return (
					<Image src={block.image} filename={PathUtils.name(block.path)} />
				);
			}
			if (block.document) {
				return <Document path={block.path} document={block.document} />;
			}
			return (
				<Tail height={TAIL_HEIGHT} follow={active} content={block.content}>
					<Code
						code={block.content ?? ""}
						language={block.language}
						filename={block.path}
						streaming={active}
					/>
				</Tail>
			);
		case "diff":
			return (
				<Tail height={TAIL_HEIGHT} follow={active} content={block.after}>
					<Diff
						before={block.before}
						after={block.after}
						language={block.language}
						filename={block.path}
					/>
				</Tail>
			);
		case "directory":
			return (
				<Code
					code={block.entries
						.map(
							(entry) =>
								`${relative(block.path, entry.path)}${entry.directory ? "/" : ""}`,
						)
						.join("\n")}
					filename={block.path}
					language="text"
				/>
			);
		case "web":
			return (
				<Tail
					height={TAIL_HEIGHT}
					follow={active}
					content={block.source.content}
				>
					<Web source={block.source} streaming={active} />
				</Tail>
			);
		case "record":
			return (
				<Stack gap={0}>
					<Text fw={500}>{block.title}</Text>
					{block.description && <Text size="sm">{block.description}</Text>}
					{block.details?.map((detail, index) =>
						block.chat && index === 0 ? (
							<Anchor
								key={detail}
								size="xs"
								href={`/#/${block.chat}`}
								onClick={(event) => {
									event.preventDefault();
									if (block.chat) ChatService.setChat({ id: block.chat });
								}}
							>
								{detail}
							</Anchor>
						) : (
							<Text key={detail} size="xs" c="dimmed">
								{detail}
							</Text>
						),
					)}
				</Stack>
			);
		case "json":
			return (
				<Stack gap={4}>
					{block.title && (
						<Text size="xs" c="dimmed">
							{block.title}
						</Text>
					)}
					<JsonTree
						data={block.value}
						defaultExpanded
						withExpandAll
						withCopyToClipboard
					/>
				</Stack>
			);
		case "messages": {
			const latest = block.data.at(-1)?.at(-1)?.type;
			const status: AgentStreamEvent["status"] | undefined = !active
				? undefined
				: latest === "thought"
					? "thinking"
					: "generating";
			return (
				<Box>
					<MessageParts data={block.data} status={status} />
				</Box>
			);
		}
	}
}
