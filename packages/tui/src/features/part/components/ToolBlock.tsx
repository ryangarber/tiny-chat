import Image from "ink-picture";
import type { ReactNode } from "react";
import type { AgentStreamEvent } from "#client/core/services/StreamService.ts";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { ToolBlock as ToolBlockType } from "#core/features/tool/types/display.ts";
import Anchor from "#tui/core/components/Anchor.tsx";
import Box from "#tui/core/components/Box.tsx";
import Content from "#tui/core/components/Content.tsx";
import Text from "#tui/core/components/Text.tsx";
import { Code } from "#tui/features/code/components/Code.tsx";
import Diff from "#tui/features/code/components/Diff.tsx";
import Markdown from "#tui/features/message/components/Markdown.tsx";
import MessageParts from "#tui/features/message/components/MessageParts.tsx";
import Quote from "#tui/features/part/components/Quote.tsx";

/** Lines a block is held to while it grows, keeping its newest in view. */
const TAIL_LINES = 12;

/**
 * Keeps only the last lines of growing content, the way a terminal scrolls,
 * with a note of how many came before. Released once the content settles.
 */
function TailLines({
	follow,
	value,
	children,
}: {
	follow: boolean;
	value: string;
	children: (value: string) => ReactNode;
}) {
	// Whole while find shows a match somewhere in it.
	const revealed = useFindRevealed();
	const lines = follow && !revealed ? value.split("\n") : [];
	const hidden = Math.max(0, lines.length - TAIL_LINES);
	useFindHidden(hidden > 0);
	if (!lines.length) return children(value);
	return (
		<Box flexDirection="column">
			{hidden > 0 && <Text dimColor>{` ⋮ ${hidden} earlier lines`}</Text>}
			{children(hidden ? lines.slice(hidden).join("\n") : value)}
		</Box>
	);
}

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

/**
 * Draws one piece of tool content. This is the whole of the CLI's knowledge
 * of tools: each tool describes itself in these blocks, so a new tool needs no
 * code here.
 */
export default function ToolBlock({
	block,
	active,
	tail = true,
}: {
	block: ToolBlockType;
	/** Whether the call is still streaming or running. */
	active: boolean;
	/**
	 * Holds growing content to its last lines. Off where it sits in a view that
	 * scrolls through the whole of it instead.
	 */
	tail?: boolean;
}) {
	switch (block.type) {
		case "text":
			return (
				<Text
					color={
						block.tone === "error"
							? "red"
							: block.tone === "dimmed"
								? "textSubtle"
								: undefined
					}
				>
					{block.value}
				</Text>
			);
		case "markdown": {
			const markdown = <Markdown source={block.value} streaming={active} />;
			return block.quote ? <Quote>{markdown}</Quote> : markdown;
		}
		case "code":
			return (
				<TailLines
					follow={tail && (active || !!block.terminal)}
					value={block.value}
				>
					{(value) => (
						<Code
							code={value}
							language={block.language}
							filename={block.title}
						/>
					)}
				</TailLines>
			);
		case "file":
			if (block.image) return <Image src={block.image} />;
			return (
				<TailLines follow={tail && active} value={block.content ?? ""}>
					{(value) => (
						<Code
							code={value}
							language={block.language}
							filename={block.path}
						/>
					)}
				</TailLines>
			);
		case "diff":
			return (
				<Diff
					before={block.before}
					after={block.after}
					language={block.language}
					filename={block.path}
				/>
			);
		case "directory":
			return (
				<Code
					language="text"
					filename={block.path}
					code={block.entries
						.map(
							(entry) =>
								`${relative(block.path, entry.path)}${entry.directory ? "/" : ""}`,
						)
						.join("\n")}
				/>
			);
		case "web":
			return (
				<Content formatter={() => block.source.content} streaming={active}>
					<Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
						<Box flexDirection="column" paddingRight={8}>
							<Text bold>
								{block.source.title ??
									URL.parse(block.source.url)?.hostname ??
									block.source.url}
							</Text>
							<Anchor href={block.source.url} wrap="truncate-end" />
						</Box>
						<TailLines follow={tail && active} value={block.source.content}>
							{(value) => <Markdown source={value} streaming={active} />}
						</TailLines>
					</Box>
				</Content>
			);
		case "record":
			return (
				<Box flexDirection="column">
					<Text bold wrap="truncate-end">
						{block.title.replaceAll("\n", " ")}
					</Text>
					{block.description && (
						<Text wrap="truncate-end">
							{block.description.replaceAll("\n", " ")}
						</Text>
					)}
					{block.details?.map((detail) => (
						<Text key={detail} color="textSubtle">
							{detail}
						</Text>
					))}
				</Box>
			);
		case "json":
			return (
				<Code
					code={JSON.stringify(block.value, null, 2) ?? "undefined"}
					language="json"
					filename={block.title}
				/>
			);
		case "messages": {
			const latest = block.data.at(-1)?.at(-1)?.type;
			const status: AgentStreamEvent["status"] | undefined = !active
				? undefined
				: latest === "thought"
					? "thinking"
					: "generating";
			return (
				<Box flexDirection="column">
					<MessageParts data={block.data} status={status} />
				</Box>
			);
		}
	}
}
