import { Pill, Stack, Text, Tooltip } from "@mantine/core";
import { createContext, useContext } from "react";
import { type Components, useIsCodeFenceIncomplete } from "streamdown";
import { ComponentUtils } from "#client/core/utils/ComponentUtils.ts";
import { StreamContext } from "#client/features/message/components/StreamContext.tsx";
import { useMessageStore } from "#client/features/message/stores/useMessageStore.ts";
import { useExpandStore } from "#client/features/part/stores/useExpandStore.ts";
import type { CodeLanguage } from "#core/core/utils/CodeUtils.ts";
import { SourceUtils } from "#core/features/data/utils/SourceUtils.ts";
import Popup from "#gui/core/components/Popup.tsx";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import Code from "#gui/features/code/components/Code.tsx";
import Mermaid from "#gui/features/code/components/Mermaid.tsx";
import { Table } from "#gui/features/message/components/MarkdownTable.tsx";
import Attachment from "#gui/features/part/components/Attachment.tsx";
import Command from "#gui/features/part/components/Command.tsx";
import Paste from "#gui/features/part/components/Paste.tsx";
import Quote from "#gui/features/part/components/Quote.tsx";
import SourceChip from "#gui/features/part/components/SourceChip.tsx";

const CodeBlockContext = createContext(false);

const PreComponent: Components["pre"] = ({ children }) => {
	return <CodeBlockContext value={true}>{children}</CodeBlockContext>;
};

const LANGUAGE_REGEX = /language-(\S+)/;
const START_LINE_PATTERN = /startLine=(\d+)/;
const NO_LINE_NUMBERS_PATTERN = /\bnoLineNumbers\b/;

const CodeComponent: Components["code"] = ({
	node,
	className,
	children,
	...props
}) => {
	const inline = !useContext(CodeBlockContext);
	const streaming = useContext(StreamContext);
	const incomplete = useIsCodeFenceIncomplete();

	const language = className?.match(LANGUAGE_REGEX)?.[1] ?? "";

	if (inline) {
		return (
			<code
				className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
				data-streamdown="inline-code"
				{...props}
			>
				{children}
			</code>
		);
	}

	const metastring = node?.properties?.metastring as string | undefined;

	const startLineMatch = metastring?.match(START_LINE_PATTERN);
	const parsedStartLine = startLineMatch
		? Number.parseInt(startLineMatch[1], 10)
		: undefined;
	const startLine =
		parsedStartLine !== undefined && parsedStartLine >= 1
			? parsedStartLine
			: undefined;

	const noLineNumbers = metastring
		? NO_LINE_NUMBERS_PATTERN.test(metastring)
		: false;

	const code = ComponentUtils.text({ children });

	if (language === "mermaid") {
		return <Mermaid code={code} streaming={streaming} />;
	}

	return (
		<Code
			code={code}
			language={language as CodeLanguage}
			filename={language}
			startLine={startLine}
			lineNumbers={!noLineNumbers}
			streaming={streaming}
			incomplete={incomplete}
		/>
	);
};

/** How long a call gone to is waited on to be drawn, before giving up on it. */
const FOCUS_TIMEOUT = 2000;

const focusToolCall = (id: string) => {
	const { focus } = useExpandStore.getState();
	focus(id);
	setTimeout(() => {
		if (useExpandStore.getState().focused === id) focus(null);
	}, FOCUS_TIMEOUT);
};

const citationPillProps = {
	size: "xs",
	h: "auto",
	my: 0,
	mx: 2,
	py: 2,
	px: 5.25,
	fz: "0.7em",
	display: "inline-flex",
	bg: "var(--tc-interior)",
} as const;

const MarkComponent: Components["mark"] = ({ children, node }) => {
	// Read per-citation rather than through the markdown context: sources change
	// whenever a chat-scoped query settles, and only this component cares.
	const sources = useMessageStore((s) => s.sources);
	const keys = SourceUtils.matchKeys({
		sources,
		keys: ComponentUtils.props(node, { sources: "" }).sources,
	});
	const text = ComponentUtils.text({ children });
	return (
		<span>
			{children}
			{keys.map((key) => {
				const source = SourceUtils.getDisplay({ sources, key, text });
				// The call is drawn in the chat already, so it is gone to instead.
				if (source.type === "toolCall")
					return (
						<Tooltip key={key} label={source.title}>
							<Pill
								{...citationPillProps}
								style={{ cursor: "pointer" }}
								onClick={() => focusToolCall(source.value.id)}
							>
								{source.emoji}
							</Pill>
						</Tooltip>
					);
				return (
					<Popup key={key}>
						<Popup.Target>
							<Pill {...citationPillProps} style={{ cursor: "default" }}>
								{source.emoji}
							</Pill>
						</Popup.Target>
						<Popup.Dropdown c="var(--mantine-color-text)">
							<Stack gap="xs" maw={300}>
								{source.type === "memory" || source.type === "action" ? (
									<SourceChip path={`${source.type}:${source.value.id}`}>
										<Text flex={1} miw={0} truncate size="xs">
											{source.title}
										</Text>
									</SourceChip>
								) : source.type === "file" || source.type === "web" ? (
									<SourceChip
										path={
											source.type === "web"
												? `web:${source.value.url}`
												: source.value.path
										}
										directory={
											source.type === "web" ? false : source.value.directory
										}
										web={source.type === "web" ? source.value : undefined}
									>
										<Text flex={1} miw={0} truncate size="xs">
											{source.type === "web"
												? (source.value.title ?? source.value.url)
												: source.value.path}
										</Text>
									</SourceChip>
								) : (
									<>
										<Text size="sm" fw={500} lineClamp={2}>
											{source.title}
										</Text>
										<Text
											textWrap="pretty"
											style={{
												wordBreak: "break-word",
												whiteSpace: "pre-wrap",
											}}
											size="xs"
										>
											{source.description}
										</Text>
									</>
								)}
							</Stack>
						</Popup.Dropdown>
					</Popup>
				);
			})}
		</span>
	);
};

const BlockquoteComponent: Components["blockquote"] = ({ node, children }) => {
	const { model } = ComponentUtils.props(node, { model: undefined });
	return <Quote model={model}>{children}</Quote>;
};

const AComponent: Components["a"] = ({ href, children }) => {
	const runtime = useRuntime();
	return (
		<a
			href={href}
			onClick={(e) => {
				if (!href) return;
				e.preventDefault();
				void runtime.open(href);
			}}
		>
			{children}
		</a>
	);
};

const LinkComponent: Components["link"] = ({ node }) => {
	const {
		source,
		name,
		"is-directory": isDirectory,
	} = ComponentUtils.props(node, {
		source: "?",
		name: undefined,
		"is-directory": false,
	});
	return <Attachment source={source} name={name} directory={isDirectory} />;
};

const SlotComponent: Components["slot"] = ({ node, children }) => {
	const name = ((node?.properties.name ?? "unknown") as string).replace(
		"user-content-",
		"",
	);
	return <Command name={name} content={children} />;
};

const DetailsComponent: Components["details"] = ({ node, children }) => {
	const { lines } = ComponentUtils.props(node, { lines: undefined });
	return <Paste lines={lines}>{children}</Paste>;
};

const TableComponent: Components["table"] = ({ children }) => {
	const streaming = useContext(StreamContext);
	return (
		<Table withButtons streaming={streaming} mb={10}>
			{children}
		</Table>
	);
};

export const MarkdownComponents: Components = {
	pre: PreComponent,
	code: CodeComponent,
	mark: MarkComponent,
	blockquote: BlockquoteComponent,
	a: AComponent,
	link: LinkComponent,
	slot: SlotComponent,
	details: DetailsComponent,
	table: TableComponent,
};
