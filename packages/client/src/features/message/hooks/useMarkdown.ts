import type { Root as HastRoot } from "hast";
import type {
	Code,
	Root as MdastRoot,
	Nodes,
	Parent,
	RootContent,
} from "mdast";
import { type JSX, useMemo } from "react";
import RehypeKatex from "rehype-katex";
import RehypeRaw from "rehype-raw";
import RehypeSanitize, { defaultSchema } from "rehype-sanitize";
import RemarkBreaks from "remark-breaks";
import RemarkDirective from "remark-directive";
import RemarkGfm from "remark-gfm";
import RemarkMath from "remark-math";
import RemarkParse from "remark-parse";
import RemarkRehype from "remark-rehype";
import { type PluggableList, type Processor, unified } from "unified";
import { visit } from "unist-util-visit";
import { useStableValue } from "#client/core/hooks/useStableValue.ts";
import { MarkdownUtils } from "#client/features/message/utils/MarkdownUtils.ts";
import type { zData } from "#core/features/data/types/part.ts";
import {
	EditorPartUtils,
	type zEditorPart,
} from "#core/features/data/utils/EditorPartUtils.ts";

export type * from "mdast";
export type * from "mdast-util-to-hast";

export type MarkdownSource = string | zData;

const allowedTags: Partial<Record<keyof JSX.IntrinsicElements, string[]>> = {
	blockquote: ["model"],
	mark: ["sources"],
	link: ["source", "is-directory"],
	slot: ["name", "value", "accepts-content", "needs-run"],
	details: ["lines"],
};

type DirectiveKind = "text" | "leaf" | "container";

type MicromarkToken = { type: string };

type MicromarkConstruct = {
	tokenize: (
		this: {
			events: Array<["enter" | "exit", MicromarkToken, ...unknown[]]>;
			sliceSerialize: (token: MicromarkToken) => string;
		},
		effects: unknown,
		ok: (code: number | null) => unknown,
		nok: (code: number | null) => unknown,
	) => unknown;
	previous?: unknown;
	concrete?: boolean;
};

type MicromarkDirectiveExtension = {
	text?: { 58?: MicromarkConstruct };
	flow?: { 58?: MicromarkConstruct | MicromarkConstruct[] };
};

/**
 * remark-directive's default tokenizer is greedy: `:1` is a text directive and
 * `::1` is a leaf, which turns ratios, emphasis like `*1:1*`, and IPv6 `::1`
 * into nodes. Text directives need `[]` and names start with a letter, so
 * reject anything that doesn't match here, at parse time, before it can split
 * a paragraph.
 */
const wrapDirectiveConstruct = (
	construct: MicromarkConstruct,
	kind: DirectiveKind,
): MicromarkConstruct => ({
	...construct,
	tokenize(effects, ok, nok) {
		return construct.tokenize.call(
			this,
			effects,
			(code) => {
				const cap = `${kind[0].toUpperCase()}${kind.slice(1)}`;
				const nameType = `directive${cap}Name`;
				const labelType = `directive${cap}Label`;
				let name = "";
				let hasLabel = false;
				for (const [enter, token] of this.events) {
					if (enter === "exit" && token.type === nameType) {
						name = this.sliceSerialize(token);
					}
					if (enter === "enter" && token.type === labelType) {
						hasLabel = true;
					}
				}
				if (!/^[A-Za-z]/.test(name)) return nok(code);
				if (kind === "text" && !hasLabel) return nok(code);
				return ok(code);
			},
			nok,
		);
	},
});

function restrictDirectiveSyntax(this: Processor) {
	const extensions = (
		this.data() as { micromarkExtensions?: MicromarkDirectiveExtension[] }
	).micromarkExtensions;
	const extension = extensions?.find(
		(candidate) => candidate.text?.[58] && candidate.flow?.[58],
	);
	if (!extension?.text?.[58] || !extension.flow?.[58]) return;

	extension.text[58] = wrapDirectiveConstruct(extension.text[58], "text");
	const flow = Array.isArray(extension.flow[58])
		? extension.flow[58]
		: [extension.flow[58]];
	extension.flow[58] = [
		wrapDirectiveConstruct(flow[0], "container"),
		wrapDirectiveConstruct(flow[1], "leaf"),
	];
}

const createDirectives = () => {
	const toNode = (
		node: Extract<
			Nodes,
			{ type: "textDirective" | "leafDirective" | "containerDirective" }
		>,
		name: keyof JSX.IntrinsicElements,
	) => {
		node.data ??= {};
		node.data.hName = name;
		node.data.hProperties = { ...node.attributes };
	};

	return (tree: MdastRoot) => {
		visit(tree, (node) => {
			if (
				node.type !== "containerDirective" &&
				node.type !== "leafDirective" &&
				node.type !== "textDirective"
			)
				return;

			if (node.name === "writing") toNode(node, "blockquote");
		});
	};
};

/** What a run's markers index into, for {@link createEditorParts}. */
type EditorPartsData = { parts?: readonly zEditorPart[] };

/** A node remark-rehype draws as the element its data names. */
type EditorPartNode = {
	type: "editorPart";
	block: boolean;
	data: { hName: string; hProperties: Record<string, string | undefined> };
	children: RootContent[];
};

/** The node as a block part, or null when it is anything else. */
const asBlockPart = (node: { type: string }) =>
	node.type === "editorPart" && (node as unknown as EditorPartNode).block
		? (node as unknown as EditorPartNode)
		: null;

/** Text that is nothing but space and line breaks, between two blocks. */
const isBlank = (node: RootContent) =>
	(node.type === "text" && !node.value.trim()) || node.type === "break";

/** The node a part is drawn as, in place of the marker standing for it. */
const toEditorPartNode = (part: zEditorPart): EditorPartNode | Code => {
	const node = (
		hName: string,
		hProperties: EditorPartNode["data"]["hProperties"],
		children: RootContent[] = [],
	): EditorPartNode => ({
		type: "editorPart",
		block: !EditorPartUtils.isInline(part.type),
		data: { hName, hProperties },
		children,
	});
	const markdown = (text: string) =>
		processor.parse(EditorPartUtils.strip(text)).children;

	if (part.type === "attachment") {
		return node("link", {
			source: part.source,
			name: part.label || undefined,
			"is-directory": part.content.type === "directory" ? "true" : undefined,
		});
	}

	if (part.type === "command") {
		return node(
			"slot",
			{ name: part.name, value: part.value },
			part.argument ? [{ type: "text", value: part.argument }] : [],
		);
	}

	if (part.type === "quote") {
		return node("blockquote", { model: part.model }, markdown(part.text));
	}

	const code: Code = { type: "code", lang: part.language, value: part.text };
	// A paste from before every paste was folded away reads as the block it is.
	if (part.collapsed === false) return code;

	// Source is drawn as code, and anything else as the Markdown it was written
	// in, which is how prose would have read had it been typed rather than
	// pasted.
	return node(
		"details",
		{ lines: String(part.lines) },
		part.language ? [code] : markdown(part.text),
	);
};

/**
 * Draws the editor parts of a run where their markers stand.
 *
 * A message is written as text with attachments, commands, quotes and pastes
 * in among it, and is joined into one string to be parsed — each part
 * standing in it as one character of its own (see `EditorPartUtils.join`).
 * That character is inert to Markdown, so a part can never be taken apart by
 * the syntax around it; this swaps it back for the part in the parsed tree. A
 * quote or a paste is a block, and is lifted out of the paragraph it landed
 * in.
 *
 * The parts come from the plugin's options when there are any, and otherwise
 * from the file being processed, so one processor can render any run.
 */
function createEditorParts(options?: EditorPartsData) {
	return (tree: MdastRoot, file: { data: object }) => {
		const parts = options?.parts ?? (file.data as EditorPartsData).parts ?? [];
		const part = (character: string) => {
			const index = EditorPartUtils.index(character);
			return index === null ? undefined : parts[index];
		};

		// Code is drawn as it was written, so a part in it is written as the text
		// it would have been typed as.
		const written = (value: string) =>
			value.replace(EditorPartUtils.markers(), (character) => {
				const found = part(character);
				return found ? EditorPartUtils.toText(found) : "";
			});

		visit(tree, (node, index, parent) => {
			if (node.type === "code" || node.type === "inlineCode") {
				node.value = written(node.value);
				return;
			}
			if (node.type !== "text" || !parent || index === undefined) return;

			const pieces = node.value.split(/([\uE000-\uE7FF])/);
			if (pieces.length === 1) return;

			const replaced = pieces.flatMap((piece, at): RootContent[] => {
				if (at % 2 === 0) return piece ? [{ type: "text", value: piece }] : [];
				const found = part(piece);
				return found ? [toEditorPartNode(found) as RootContent] : [];
			});
			parent.children.splice(index, 1, ...(replaced as typeof parent.children));
			return index + replaced.length;
		});

		// A block part only ever lands in a paragraph, which is broken around it.
		visit(tree, (node) => {
			if (!("children" in node)) return;
			const parent = node as Parent;

			parent.children = parent.children.flatMap((child): RootContent[] => {
				if (child.type !== "paragraph" || !child.children.some(asBlockPart))
					return [child];

				const blocks: RootContent[] = [];
				let run: RootContent[] = [];
				const flush = () => {
					while (run.length && isBlank(run[0])) run.shift();
					while (run.length && isBlank(run[run.length - 1])) run.pop();

					// The line breaks that stood it apart from the part go with it.
					const first = run[0];
					if (first?.type === "text") first.value = first.value.trimStart();
					const last = run[run.length - 1];
					if (last?.type === "text") last.value = last.value.trimEnd();

					if (run.length)
						blocks.push({ type: "paragraph", children: run } as RootContent);
					run = [];
				};

				for (const inline of child.children as RootContent[]) {
					if (asBlockPart(inline)) {
						flush();
						blocks.push(inline as unknown as RootContent);
					} else run.push(inline);
				}
				flush();

				return blocks;
			});
		});
	};
}

const createCodeMeta = () => (tree: MdastRoot) => {
	visit(tree, "code", (node: Code) => {
		if (node.meta) {
			node.data = node.data ?? {};
			node.data.hProperties = {
				...((node.data.hProperties as Record<string, unknown>) ?? {}),
				metastring: node.meta,
			};
		}
	});
};

const remarkPlugins: PluggableList = [
	// First, so the transforms after it see what a part is drawn as.
	createEditorParts,
	RemarkBreaks,
	RemarkGfm,
	RemarkDirective,
	restrictDirectiveSyntax,
	[RemarkMath, { singleDollarTextMath: false }],
	createDirectives,
	createCodeMeta,
];

/**
 * Drops the whitespace mdast-util-to-hast inserts between block elements,
 * which renderers that lay blocks out themselves have no way to render.
 *
 * The marker is the newline: structural whitespace always has one, and text
 * that flows never does, since remark-breaks turns soft breaks into `<br>`.
 * That distinction matters twice over — rehype-raw's reparse merges adjacent
 * text nodes, so a structural newline can end up inside `"item text\n"`
 * rather than in a whitespace-only node of its own, while the joining space
 * between two inline spans *is* its own whitespace-only node and has to
 * survive, or `**a** *b*` renders as `**a***b*`.
 */
const createNewlines = () => (tree: HastRoot) => {
	visit(tree, "text", (node, index, parent) => {
		if (!parent || index == null) return;
		// Text inside these is content, so its newlines are load-bearing.
		if (parent.type === "element" && ["pre", "code"].includes(parent.tagName))
			return;

		node.value = node.value.replace(/\n[ \t]*/g, "");

		if (node.value === "") {
			parent.children.splice(index, 1);
			return index; // revisit same index since we spliced
		}
	});
};

const rehypePlugins: PluggableList = [
	RehypeRaw,
	[
		RehypeSanitize,
		{
			tagNames: [
				...(defaultSchema.tagNames ?? []),
				...Object.keys(allowedTags),
			],
			attributes: { ...defaultSchema.attributes, ...allowedTags },
		},
	],
	createNewlines,
];

const rehypePluginsWithKatex: PluggableList = [...rehypePlugins, RehypeKatex];

export const processor = unified()
	.use(RemarkParse)
	.use(remarkPlugins)
	.use(RemarkRehype, { allowDangerousHtml: true })
	.use(rehypePlugins);

/**
 * The agent's own `<message role=… model=…>` wrapper, which is transport rather
 * than content.
 *
 * It has to come off before parsing. It is not in `allowedTags`, so rehype
 * sanitizes it away in the end regardless — but while it is still there remark
 * reads it as an HTML block, which swallows everything up to the first blank
 * line (a leading heading renders as literal `## text`). Worse during a stream:
 * until the closing tag arrives the tag is unbalanced, and a block splitter has
 * to treat the whole document as one block, which is exactly the incremental
 * rendering the split is meant to enable.
 */
const NO_PARTS: zEditorPart[] = [];

const isSameParts = (a: readonly zEditorPart[], b: readonly zEditorPart[]) =>
	a.length === b.length && a.every((part, index) => part === b[index]);

const MESSAGE_OPEN = /^\s*<message[^>]*>\n?/;
const MESSAGE_CLOSE = /\n?<\/message>\s*$/;

export const useMarkdown = ({
	source,
	withKatex,
}: {
	source: MarkdownSource;
	withKatex?: boolean;
}) => {
	const joined = useMemo(() => {
		if (typeof source === "string") return { text: source, parts: NO_PARTS };

		const { source: text, parts } = EditorPartUtils.join(
			source.flat().filter(EditorPartUtils.isRun),
		);
		return { text, parts };
	}, [source]);
	const { text } = joined;

	// Every block is drawn with the parts, so they are held for as long as they
	// are the same parts: a source is rebuilt by whatever renders it, and parts
	// joined anew from it would miss every block's memo and parse the whole
	// message again with each render — each token, while it streams.
	const parts = useStableValue(joined.parts, isSameParts);

	const content = useMemo(() => {
		const normalized = MarkdownUtils.normalize(
			text
				.replace(MESSAGE_OPEN, "")
				.replace(MESSAGE_CLOSE, "")
				.replace(
					/<cite sources="([^>]+)"([/ ]+)?>/g,
					(_, p1, p2) =>
						`<mark sources="${p1.replace(/" "/g, " ")}"${p2 ?? ""}>`,
				),
		);
		return normalized;
	}, [text]);

	// A renderer that runs its own processor is handed the parts with the
	// plugin, and one that runs `processor` passes them with the file.
	const plugins = useMemo<PluggableList>(
		() =>
			parts.length
				? [[createEditorParts, { parts }], ...remarkPlugins.slice(1)]
				: remarkPlugins,
		[parts],
	);

	return {
		remarkPlugins: plugins,
		parts,
		rehypePlugins: withKatex ? rehypePluginsWithKatex : rehypePlugins,
		allowedTags,
		processor,
		content,
	};
};

export const _useMarkdownTest = () => {
	type Slim = string | [string, ...Slim[]];

	const slim = (node: {
		type: string;
		name?: string | null;
		tagName?: string | null;
		value?: string | null;
		children?: Array<typeof node> | null;
	}): Slim => {
		if (node.type === "text") return node.value ?? "";
		const name = node.tagName ?? node.name ?? node.type;
		return [name, ...(node.children?.map(slim) ?? [])];
	};

	return {
		parse: (source: string) => slim(processor.parse(source)),
		run: (source: string, parts: readonly zEditorPart[] = []) =>
			slim(processor.runSync(processor.parse(source), { data: { parts } })),
	};
};
