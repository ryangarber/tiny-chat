import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SnippetService } from "#core/features/data/services/SnippetService.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import type { MemoryState } from "#core/features/data/types/memory.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type {
	zToolCallPart,
	zToolResultPart,
} from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { zWebContext } from "#core/features/provider/types/web.ts";
import { edit_file } from "#core/features/tool/tools/shell/edit_file.ts";
import { grep_files } from "#core/features/tool/tools/shell/grep_files.ts";
import { read_dir } from "#core/features/tool/tools/shell/read_dir.ts";
import { read_file } from "#core/features/tool/tools/shell/read_file.ts";
import { search_files } from "#core/features/tool/tools/shell/search_files.ts";
import { write_file } from "#core/features/tool/tools/shell/write_file.ts";
import { search_web } from "#core/features/tool/tools/web/search_web.ts";
import { view_web } from "#core/features/tool/tools/web/view_web.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import { GitHubSourceUtils } from "#core/features/tool/utils/GitHubSourceUtils.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

export type Source = {
	key: string;
	/** The tool call that produced it, which models also cite by its ID. */
	call?: string;
} & (
	| {
			type: "web";
			value: zWebContext;
	  }
	| { type: "memory"; value: MemoryState }
	| { type: "action"; value: ActionState }
	| { type: "file"; value: { path: string; directory: boolean } }
	/**
	 * A cited call whose result is none of the above. It is already drawn in
	 * the chat, so it is pointed at rather than listed anywhere.
	 */
	| { type: "toolCall"; value: { id: string; title: string; error: boolean } }
);

type SourceDisplay<T extends Source["type"] | "unknown"> =
	(T extends Source["type"]
		? Extract<Source, { type: T }>
		: { type: "unknown" }) & {
		emoji: string;
		title: string;
		description: string;
	};

type SourceDisplayType =
	| SourceDisplay<"web">
	| SourceDisplay<"memory">
	| SourceDisplay<"action">
	| SourceDisplay<"file">
	| SourceDisplay<"toolCall">
	| SourceDisplay<"unknown">;

const SOURCE_DISTANCE_LIMIT = 0.1;

const EMOJIS: Record<SourceDisplayType["type"], string> = {
	web: "🔗",
	memory: "🧠",
	action: "⚡",
	file: "📎",
	toolCall: "🔧",
	unknown: "❔",
};

const normalizeKey = (key: string) =>
	key
		.trim()
		.replace(/^["'`]+|["'`]+$/g, "")
		.toLowerCase();

const findClosestSource = ({
	sources,
	key,
}: {
	sources?: Source[];
	key: string;
}) => {
	const normalizedKey = normalizeKey(key);
	if (!normalizedKey) return;

	let closest: { source: Source; distance: number } | undefined;
	for (const source of sources ?? []) {
		const distance = CommonUtils.getDistance(
			normalizeKey(source.key),
			normalizedKey,
		);
		if (!closest || distance < closest.distance) closest = { source, distance };
	}
	return closest && closest.distance < SOURCE_DISTANCE_LIMIT
		? closest.source
		: undefined;
};

const matchClause = ({
	sources,
	clause,
}: {
	sources?: Source[];
	clause: string;
}) => {
	const whole = findClosestSource({ sources, key: clause });
	if (whole) return [whole.key];

	const words = clause.trim().split(/\s+/).filter(Boolean);
	const keys: string[] = [];
	for (let start = 0; start < words.length; ) {
		let match: Source | undefined;
		let end = words.length;
		for (; end > start; end--) {
			match = findClosestSource({
				sources,
				key: words.slice(start, end).join(" "),
			});
			if (match) break;
		}

		if (match) {
			keys.push(match.key);
			start = end;
		} else {
			keys.push(words[start] ?? "");
			start++;
		}
	}
	return keys;
};

/**
 * A cited call ID stands for whatever that call produced, so a call that read
 * pages or files cites them; anything else is kept for its fallback source.
 */
const expandCall = ({ sources, key }: { sources?: Source[]; key: string }) => {
	const normalizedKey = normalizeKey(key);
	const produced =
		sources?.filter(
			(source) => source.call && normalizeKey(source.call) === normalizedKey,
		) ?? [];
	return produced.length ? produced.map((source) => source.key) : [key];
};

/** Sources read out of a supported tool's result. */
const fromToolCall = ({
	part,
	result,
	toolsets,
}: {
	part: zToolCallPart;
	result?: zToolResultPart;
	toolsets: Toolset<any>[];
}): Source[] => {
	const { tool } = ToolUtils.find({ toolsets, part });
	if (tool?.name.startsWith("github_") && !result?.error) {
		return GitHubSourceUtils.parse(tool.name, ToolUtils.json(result, true)).map(
			(value) => ({ key: value.url, type: "web", value }),
		);
	}
	if (ToolUtils.is(toolsets, part, search_web)) {
		const output = ToolUtils.json<typeof search_web>(result, true);
		return (
			output.map((value) => ({
				key: value.url,
				type: "web",
				value,
			})) ?? []
		);
	} else if (ToolUtils.is(toolsets, part, view_web)) {
		const output = ToolUtils.json<typeof view_web>(result);
		return output[0]
			? [{ key: output[0].url, type: "web", value: output[0] }]
			: [];
	} else if (ToolUtils.is(toolsets, part, read_file)) {
		const output = ToolUtils.file(result);
		return output[0]
			? [
					{
						key: part.input.path,
						type: "file",
						value: {
							path: part.input.path,
							directory: false,
						},
					},
				]
			: [];
	} else if (ToolUtils.is(toolsets, part, read_dir)) {
		const output = ToolUtils.json<typeof read_dir>(result, true);
		return output.map((item) => ({
			key: item.path,
			type: "file",
			value: {
				path: item.path,
				directory: item.is_dir,
			},
		}));
	} else if (
		ToolUtils.is(toolsets, part, search_files) ||
		ToolUtils.is(toolsets, part, grep_files)
	) {
		const output = ToolUtils.json<typeof grep_files | typeof search_files>(
			result,
			true,
		);
		return output.map((item) => ({
			key: item.path,
			type: "file",
			value: {
				path: item.path,
				directory: false,
			},
		}));
	} else if (
		ToolUtils.is(toolsets, part, write_file) ||
		ToolUtils.is(toolsets, part, edit_file)
	) {
		const output = ToolUtils.json<typeof write_file | typeof edit_file>(result);
		return output[0]
			? [
					{
						key: output[0].path,
						type: "file",
						value: {
							path: output[0].path,
							directory: false,
						},
					},
				]
			: [];
	}
	return [];
};

export const SourceUtils = {
	/**
	 * Resolves the simple source list emitted by models without requiring a
	 * quoting or escaping format. A complete clause wins first (so file names
	 * may contain spaces), then its longest matching word spans are consumed.
	 */
	matchKeys: ({ sources, keys }: { sources?: Source[]; keys: string }) => {
		const whole = findClosestSource({ sources, key: keys });
		if (whole) return [whole.key];

		const matched = keys
			.split(/[;,\n]+/)
			.flatMap((clause) => matchClause({ sources, clause }))
			.filter(Boolean)
			.flatMap((key) => expandCall({ sources, key }));
		return [...new Set(matched)];
	},

	find: ({
		message,
		toolsets,
	}: {
		message: Pick<MessageState, "data">;
		toolsets: Toolset<any>[];
	}): Source[] => {
		return message.data.flat().flatMap((part, _index, array): Source[] => {
			if (part.type === "attachment" && part.content.type === "web") {
				return [
					{
						key: part.source.replace(/^web:/, ""),
						type: "web",
						value: {
							url: part.source.replace(/^web:/, ""),
							title: part.content.title,
							content: part.content.content,
						},
					},
				];
			}
			if (part.type === "toolCall" && !part.partial) {
				const result = array.find(
					(p): p is zToolResultPart =>
						p.type === "toolResult" && p.id === part.id,
				);
				const produced = fromToolCall({ part, result, toolsets });
				if (produced.length)
					return produced.map((source) => ({ ...source, call: part.id }));

				const status = ToolCallUtils.getStatus({
					part: { ...part, result },
					toolsets,
				});
				return [
					{
						key: part.id,
						call: part.id,
						type: "toolCall",
						value: {
							id: part.id,
							title: ToolCallUtils.resolveStatus(status)
								.map((piece) => piece.text)
								.join(" "),
							error: !!result?.error,
						},
					},
				];
			}
			return [];
		});
	},

	/** The emoji any source of `type` is shown with. */
	getTypeEmoji: (type: SourceDisplayType["type"]) => EMOJIS[type],

	/** The emoji {@link SourceUtils.getDisplay} would give, without the rest of it. */
	getEmoji: ({ sources, key }: { sources?: Source[]; key: string }) =>
		EMOJIS[findClosestSource({ sources, key })?.type ?? "unknown"],

	getDisplay: ({
		sources,
		key,
		text,
	}: {
		sources?: Source[];
		key: string;
		text: string;
	}): SourceDisplayType => {
		if (!key) console.warn("[SourceUtils] source is missing a key");
		const source = findClosestSource({ sources, key });

		if (source?.type === "web") {
			return {
				...source,
				emoji: EMOJIS.web,
				title: PathUtils.hostname(source.value.url) ?? key,
				description: SnippetService.getSnippet({
					text: source.value.content,
					query: text,
				}),
			};
		} else if (source?.type === "memory") {
			return {
				...source,
				emoji: EMOJIS.memory,
				title: source.value.fact,
				description: `Learned ${CommonUtils.formatDate({ date: source.value.createdAt, relative: true })}.`,
			};
		} else if (source?.type === "action") {
			return {
				...source,
				emoji: EMOJIS.action,
				title: DataUtils.getTextCleaned({ data: source.value.data }),
				description: source.value.nextRunAt
					? `Next run ${CommonUtils.formatDate({ date: source.value.nextRunAt, relative: true })}.`
					: "All runs completed.",
			};
		} else if (source?.type === "file") {
			return {
				...source,
				emoji: EMOJIS.file,
				title: PathUtils.name(source.value.path),
				description: source.value.path,
			};
		} else if (source?.type === "toolCall") {
			return {
				...source,
				emoji: EMOJIS.toolCall,
				title: source.value.title,
				description: source.value.error ? "Tool call failed" : "Tool call",
			};
		} else {
			return {
				type: "unknown",
				title: key,
				description: "Source not found",
				emoji: EMOJIS.unknown,
			};
		}
	},
} as const;
