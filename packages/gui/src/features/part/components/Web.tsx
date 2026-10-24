import { Anchor, Box, Stack, Text } from "@mantine/core";
import { useCallback, useMemo } from "react";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import Content, {
	type ContentFormatterFunction,
} from "#gui/core/components/Content.tsx";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import Markdown from "#gui/features/message/components/Markdown.tsx";

export default function Web({
	source,
	streaming,
	...props
}: Parameters<typeof Content>[0] & {
	source: zWebContext;
}) {
	const runtime = useRuntime();
	const formats = useMemo(() => ["Markdown"], []);
	const formatter = useCallback<ContentFormatterFunction>(
		() => ({
			filename: `${URL.parse(source.url)?.hostname ?? "web"}.md`,
			extension: "md",
			mime: "text/plain",
			data: source.content,
		}),
		[source],
	);

	return (
		<Content
			formats={formats}
			formatter={formatter}
			streaming={streaming}
			findLabel={source.title ?? URL.parse(source.url)?.hostname ?? "Page"}
			bg="var(--tc-surface)"
			style={{ borderRadius: "var(--mantine-radius-md)" }}
			{...props}
		>
			<Box h="100%" p="sm" className="markdown-sm" style={{ overflow: "auto" }}>
				<Stack gap={0} pr={110} mb="sm" miw={0}>
					<Text size="sm" fw={600} truncate>
						{source.title ?? URL.parse(source.url)?.hostname ?? source.url}
					</Text>
					<Anchor
						size="xs"
						href={source.url}
						target="_blank"
						truncate="end"
						onClick={(event) => {
							event.preventDefault();
							void runtime.open(source.url);
						}}
					>
						{source.url}
					</Anchor>
				</Stack>
				<Markdown source={source.content} streaming={streaming} />
			</Box>
		</Content>
	);
}
