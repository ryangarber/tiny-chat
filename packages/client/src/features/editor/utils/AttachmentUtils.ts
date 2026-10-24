import type {
	AttachmentGroup,
	AttachmentItem,
	AttachmentQuery,
} from "#client/features/editor/types/attachment.ts";
import type { CommandEdit } from "#client/features/editor/types/command.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";
import { CommandUtils } from "#client/features/editor/utils/CommandUtils.ts";
import { CompletionUtils } from "#client/features/editor/utils/CompletionUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/** `@path`, at the end of a line. Spaces and backslashes may be escaped. */
const QUERY_REGEX = /(?:^|\s)@((?:\\[\\ \t]|[^\s])*)$/;

const escapeQuery = (value: string) =>
	value.replaceAll("\\", "\\\\").replaceAll(" ", "\\ ");
const unescapeQuery = (value: string) => value.replace(/\\([\\ ])/g, "$1");

export const AttachmentUtils = {
	/**
	 * Find an attachment query at the end of a text run. Literal spaces end the
	 * query; escaped spaces belong to it, so ordinary prose is never swallowed.
	 */
	match: (content: string): AttachmentQuery | null => {
		const match = QUERY_REGEX.exec(content);
		if (!match) return null;

		const [raw, encoded] = match;
		const from = match.index + raw.indexOf("@");
		return {
			text: unescapeQuery(encoded),
			from,
			to: content.length,
		};
	},

	/**
	 * Locate the attachment being typed at `cursor` in a plain text buffer.
	 */
	query: ({
		content,
		cursor,
	}: {
		content: string;
		cursor?: [row: number, column: number];
	}): AttachmentQuery | null => {
		if (!cursor) return null;

		const [row, column] = cursor;
		// Read against the buffer with its atoms blanked out, so an attachment
		// already written into one is not taken for a path still being typed.
		const lines = AtomUtils.mask({
			content,
			atoms: AtomUtils.atoms(),
		}).split("\n");
		const line = lines[row];
		if (line === undefined) return null;

		const match = AttachmentUtils.match(line.slice(0, column));
		if (!match) return null;

		const offset = lines
			.slice(0, row)
			.reduce((total, line) => total + line.length + 1, 0);

		return {
			text: match.text,
			from: offset + match.from,
			to: offset + match.to,
		};
	},

	/**
	 * Narrow attachment groups to those matching `query`, given the last path
	 * segment being typed. Paths that traverse into a directory only include
	 * items that can be traversed into further. A group that was already
	 * matched keeps its items and their order.
	 */
	filter: ({
		groups,
		query = "",
	}: {
		groups: AttachmentGroup[];
		query?: string;
	}): AttachmentGroup[] => {
		const search = query.split("/").at(-1)?.trim().toLowerCase();
		const traversing = query.includes("/");

		return groups
			.map((group) => {
				const items = group.items.filter(
					(item) => !traversing || item.traversable,
				);
				return {
					...group,
					items: group.matched
						? items
						: CompletionUtils.filter({ items, query: search }),
				};
			})
			.filter((group) => group.items.length > 0);
	},

	/**
	 * An upload as an attachment: its own directory on the mount, under the name
	 * it was uploaded or cloned as. Attaching it is what pulls it into the
	 * message — there is nothing else holding it there.
	 */
	forUpload: ({
		upload,
		file,
	}: {
		upload: { id: string; name: string };
		file?: string;
	}): AttachmentItem => {
		return {
			name: upload.name,
			// A directive's attributes are read back out of a quoted, braced run, so
			// a name carrying either of those would cut the directive short.
			label: upload.name.replace(/["}]/g, ""),
			value: PathUtils.toMount({ mount: "uploads", id: upload.id, path: file }),
			// An upload stands on its own, so it can be walked into whether or not
			// anything points at it yet — under its id, which is where it lives.
			path: ["uploads", upload.id, ...(file ? [file] : [])].join("/"),
			directory: !file,
			traversable: !file,
		};
	},

	/**
	 * Another chat as an attachment, read as its transcript when attached. It
	 * is not a place on the mount, so there is nothing to walk into.
	 */
	forChat: ({
		chat,
	}: {
		chat: { id: string; title: string | null };
	}): AttachmentItem => {
		const title = `${chat.title ? `${chat.title?.slice(0, 50)}…` : "Untitled"}`;
		return {
			name: title,
			// Quoted into a directive the same way an upload's name is.
			label: title.replace(/["}]/g, ""),
			value: `chat:${chat.id}`,
		};
	},

	/**
	 * Write the chosen attachment into a plain text buffer as an atom standing
	 * for its part, which is the file's name alone.
	 */
	apply: ({
		content,
		query,
		node,
	}: {
		content: string;
		query: AttachmentQuery;
		node: EditorNode;
	}): CommandEdit => {
		const text = AtomUtils.fromNode({ content, node });

		return CommandUtils.edit({
			content,
			from: query.from,
			to: query.to,
			text: `${text} `,
		});
	},

	/**
	 * What the query becomes on traversing into `item` — the one rule for it,
	 * since every editor has its own way of putting the text back and only this
	 * part is the same between them.
	 *
	 * An item that knows its own path says where it is outright; anything else
	 * is named by what it is called, one segment at a time.
	 */
	continued: ({ query, item }: { query: string; item: AttachmentItem }) => {
		const trailing = item.directory ? "/" : "";

		const continued = item.path
			? `${item.path}${trailing}`
			: query.replace(/([^/]+)?$/, `${item.name}${trailing}`);

		return escapeQuery(continued);
	},

	/**
	 * Continue traversing into the chosen item, replacing the last path
	 * segment being typed rather than finalizing an attachment.
	 */
	complete: ({
		content,
		query,
		item,
	}: {
		content: string;
		query: AttachmentQuery;
		item: AttachmentItem;
	}): CommandEdit => {
		return CommandUtils.edit({
			content,
			from: query.from,
			to: query.to,
			text: `@${AttachmentUtils.continued({ query: query.text, item })}`,
		});
	},
} as const;
