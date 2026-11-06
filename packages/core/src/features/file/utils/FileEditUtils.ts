/** How closely `old_string` had to be matched to be found in the file. */
type FileEditStrategy = "exact" | "trimmed" | "whitespace" | "anchor";

export interface FileEdit {
	content: string;
	old_string: string;
	new_string: string;
	replace_all?: boolean;
}

export interface FileEditResult {
	content: string;
	replacements: number;
	strategy: FileEditStrategy;
}

interface Line {
	value: string;
	start: number;
	end: number;
}

interface Match {
	start: number;
	end: number;
	/** Leading whitespace of the first matched line, as it appears in the file. */
	indent: string;
}

const getIndent = (line: string) => /^[ \t]*/.exec(line)?.[0] ?? "";

/** Trims a line and reduces every run of whitespace inside it to one space. */
const getCollapsed = (line: string) => line.trim().replace(/\s+/g, " ");

/**
 * Splits text into lines, keeping each line's offsets in the original text.
 * The offsets exclude the line break itself.
 */
const getLines = (content: string) => {
	const lines: Line[] = [];
	let start = 0;
	while (true) {
		const index = content.indexOf("\n", start);
		const end = index === -1 ? content.length : index;
		lines.push({ value: content.slice(start, end), start, end });
		if (index === -1) return lines;
		start = index + 1;
	}
};

/**
 * Fuzzy line comparisons, in the order they are tried. The first one to find
 * the block wins, so they run from strictest to loosest.
 */
const strategies: {
	name: Exclude<FileEditStrategy, "exact">;
	/** Lines `old_string` needs for the comparison to be specific enough. */
	minLines: number;
	compare: (_: {
		line: string;
		search: string;
		index: number;
		count: number;
	}) => boolean;
}[] = [
	{
		name: "trimmed",
		minLines: 1,
		compare: ({ line, search }) => line.trim() === search.trim(),
	},
	{
		name: "whitespace",
		minLines: 1,
		compare: ({ line, search }) => getCollapsed(line) === getCollapsed(search),
	},
	{
		// Anchored on the first and last line only, so a block whose middle has
		// drifted (reformatted, recommented) can still be located.
		name: "anchor",
		minLines: 3,
		compare: ({ line, search, index, count }) =>
			index > 0 && index < count - 1
				? true
				: !!search.trim().length && line.trim() === search.trim(),
	},
];

const getExactMatches = ({
	content,
	search,
}: {
	content: string;
	search: string;
}) => {
	const matches: Match[] = [];
	let from = 0;
	while (true) {
		const start = content.indexOf(search, from);
		if (start === -1) return matches;
		const line = content.lastIndexOf("\n", start) + 1;
		matches.push({
			start: start,
			end: start + search.length,
			indent: getIndent(content.slice(line, start)),
		});
		from = start + search.length;
	}
};

const getFuzzyMatches = ({
	content,
	search,
	compare,
	minLines,
}: {
	content: string;
	search: string;
} & Pick<(typeof strategies)[number], "compare" | "minLines">) => {
	const lines = getLines(content);
	const searches = search.split("\n");

	// A search ending in a line break covers the break of the last line it matches.
	const trailing = searches.length > 1 && searches.at(-1) === "";
	if (trailing) searches.pop();

	const count = searches.length;
	if (count < minLines) return [];
	if (!searches.some((search) => search.trim().length)) return [];

	const matches: Match[] = [];
	let index = 0;

	while (index + count <= lines.length) {
		const window = lines.slice(index, index + count);
		const matched = window.every((line, offset) =>
			compare({
				line: line.value,
				search: searches[offset],
				index: offset,
				count,
			}),
		);
		if (!matched) {
			index++;
			continue;
		}
		const first = window[0];
		const last = window[count - 1];
		matches.push({
			start: first.start,
			end: trailing && last.end < content.length ? last.end + 1 : last.end,
			indent: getIndent(first.value),
		});
		index += count;
	}

	return matches;
};

/**
 * Moves text from one indentation level to another, leaving the relative
 * indentation of its own lines alone.
 */
const getReindented = ({
	text,
	from,
	to,
}: {
	text: string;
	from: string;
	to: string;
}) => {
	if (from === to) return text;
	return text
		.split("\n")
		.map((line) => {
			if (!line.trim().length) return line;
			return `${to}${line.startsWith(from) ? line.slice(from.length) : line.trimStart()}`;
		})
		.join("\n");
};

/**
 * Locates `search` in `content`, falling back to progressively looser line
 * comparisons so that whitespace drift in a model's copy of the file does not
 * sink the edit.
 */
const getMatches = ({
	content,
	search,
}: {
	content: string;
	search: string;
}) => {
	const exact = getExactMatches({ content, search });
	if (exact.length) {
		return { matches: exact, strategy: "exact" as const };
	}

	for (const { name, compare, minLines } of strategies) {
		const matches = getFuzzyMatches({ content, search, compare, minLines });
		if (matches.length) return { matches, strategy: name };
	}

	return { matches: [] as Match[], strategy: "exact" as const };
};

export const FileEditUtils = {
	/**
	 * Replaces `old_string` with `new_string` in `content`. Throws with an
	 * explanation the model can act on when the edit cannot be applied.
	 */
	apply: ({
		content,
		old_string,
		new_string,
		replace_all = false,
	}: FileEdit): FileEditResult => {
		if (!old_string.length) {
			throw new Error(
				"old_string is empty. Use a write step to create a file or fill in the text to replace.",
			);
		}
		if (old_string === new_string) {
			throw new Error(
				"No changes to make: old_string and new_string are exactly the same.",
			);
		}

		const { matches, strategy } = getMatches({ content, search: old_string });

		if (!matches.length) {
			throw new Error(
				"String to replace not found in file. Read the file again and copy old_string from it verbatim.",
			);
		}
		if (matches.length > 1 && !replace_all) {
			throw new Error(
				`Found ${matches.length} matches of the string to replace, but replace_all is false. Add surrounding context to old_string so it identifies one instance, or set replace_all to true.`,
			);
		}

		// Keep the file's own line endings rather than mixing in the model's.
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const indent = getIndent(old_string.split("\n")[0]);

		let edited = "";
		let cursor = 0;

		for (const match of matches) {
			const replacement =
				strategy === "exact"
					? new_string
					: getReindented({ text: new_string, from: indent, to: match.indent });
			edited += content.slice(cursor, match.start);
			edited += replacement.replace(/\r?\n/g, eol);
			cursor = match.end;
		}

		edited += content.slice(cursor);

		return { content: edited, replacements: matches.length, strategy };
	},
} as const;
