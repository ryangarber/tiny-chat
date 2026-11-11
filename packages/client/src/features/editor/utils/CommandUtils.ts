import type {
	CommandChoiceGroup,
	CommandChoiceItem,
	CommandEdit,
	CommandGroup,
	CommandItem,
	CommandQuery,
} from "#client/features/editor/types/command.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";
import { CompletionUtils } from "#client/features/editor/utils/CompletionUtils.ts";
import { EditorNodeUtils } from "#client/features/editor/utils/EditorNodeUtils.ts";

/** `/name` optionally followed by an argument, at the end of a line */
const QUERY_REGEX = /(?:^|\s)\/(\S*)(?:[ \t]+([^\n]*))?$/;

export const CommandUtils = {
	/**
	 * Whether a command carries its argument as content, either one of its
	 * choices or free text.
	 */
	acceptsContent: (command: CommandItem) =>
		!!command.choices || !!command.dynamic,

	/**
	 * Whether a command acts on the client rather than travelling with the
	 * message it was written in.
	 */
	needsRun: (command: CommandItem) =>
		!!command.run ||
		!!command.choices
			?.flatMap((group) => group.items)
			.some((item) => !!item.run),

	find: ({ groups, name }: { groups: CommandGroup[]; name?: string }) =>
		groups.flatMap((group) => group.items).find((item) => item.name === name) ??
		null,

	findChoice: ({ command, name }: { command: CommandItem; name?: string }) =>
		command.choices
			?.flatMap((group) => group.items)
			.find((item) => item.name === name) ?? null,

	/**
	 * Narrow commands to those matching `query` that are still available, given
	 * the values already used and each group's maximum.
	 */
	filter: ({
		groups,
		query = "",
		used = [],
	}: {
		groups: CommandGroup[];
		query?: string;
		used?: string[];
	}): CommandGroup[] => {
		const items = groups.flatMap((group) => group.items);

		const include = (item: CommandItem, group: CommandGroup) => {
			const usedInGroup = used.filter((value) =>
				group.items.some((item) => item.value === value),
			);
			return (
				items.filter((other) => other.value === item.value).length === 1 &&
				!used.includes(item.value) &&
				(!group.max || usedInGroup.length < group.max)
			);
		};

		return groups
			.map((group) => ({
				...group,
				items: CompletionUtils.filter({
					items: group.items.filter((item) => include(item, group)),
					query,
				}),
			}))
			.filter((group) => group.items.length > 0);
	},

	filterChoices: ({
		command,
		query = "",
	}: {
		command: CommandItem | null;
		query?: string;
	}): CommandChoiceGroup[] =>
		(command?.choices ?? [])
			.map((group) => ({
				...group,
				items: CompletionUtils.filter({ items: group.items, query }),
			}))
			.filter((group) => group.items.length > 0),

	/**
	 * Run a command with the value written for it, which may name one of its
	 * choices. Returns false when there was nothing to run.
	 */
	run: ({ command, value }: { command: CommandItem; value?: string }) => {
		if (!CommandUtils.acceptsContent(command)) {
			if (!command.run) return false;
			command.run();
			return true;
		}

		const choice = CommandUtils.findChoice({ command, name: value });
		if (choice) return CommandUtils.runChoice({ command, choice });

		if (!command.dynamic || !command.run) return false;
		command.run(value);
		return true;
	},

	/**
	 * Run a command against one of its choices. Returns false when neither the
	 * command nor the choice has anything to run.
	 */
	runChoice: ({
		command,
		choice,
	}: {
		command: CommandItem;
		choice: CommandChoiceItem;
	}) => {
		if (!command.run && !choice.run) return false;
		command.run?.(choice.name);
		choice.run?.(command);
		return true;
	},

	/**
	 * Read the command being typed at the end of `line`, the text of one line
	 * up to the cursor: its name while that is being written, or its argument
	 * once the name is followed by a space and names a command that takes one.
	 * Offsets are into `line`. Every editor reads its text through this, so
	 * typing a command and a space opens its choices the same way in each.
	 */
	match: ({
		line,
		groups,
	}: {
		line: string;
		groups: CommandGroup[];
	}): CommandQuery | null => {
		const match = QUERY_REGEX.exec(line);
		if (!match) return null;

		const [raw, name, argument] = match;
		const from = match.index + raw.indexOf("/");
		const to = line.length;

		if (argument === undefined) {
			return {
				command: null,
				text: name,
				from,
				textFrom: to - name.length,
				to,
			};
		}

		const command = CommandUtils.find({ groups, name });
		if (!command || !CommandUtils.acceptsContent(command)) return null;

		return {
			command,
			text: argument,
			from,
			textFrom: to - argument.length,
			to,
		};
	},

	/** What an empty list says: an argument without choices is typed out. */
	empty: (query: Pick<CommandQuery, "command"> | null) =>
		query?.command && !query.command.choices
			? "type a value, then enter"
			: "no matches",

	/**
	 * Locate the command being typed at `cursor` in a plain text buffer.
	 */
	query: ({
		content,
		cursor,
		groups,
	}: {
		content: string;
		cursor?: [row: number, column: number];
		groups: CommandGroup[];
	}): CommandQuery | null => {
		if (!cursor) return null;

		const [row, column] = cursor;
		// Read against the buffer with its atoms blanked out: a command already
		// written into one stands as the command itself, and typing on past it
		// would otherwise reopen it as though it were still being written.
		const lines = AtomUtils.mask({
			content,
			atoms: AtomUtils.atoms(),
		}).split("\n");
		const line = lines[row];
		if (line === undefined) return null;

		const match = CommandUtils.match({ line: line.slice(0, column), groups });
		if (!match) return null;

		const offset = lines
			.slice(0, row)
			.reduce((total, line) => total + line.length + 1, 0);
		const textFrom = offset + match.textFrom;
		const to = offset + match.to;

		return {
			command: match.command,
			// Taken from the buffer rather than the mask, so an atom the argument
			// reaches over is read as what it stands for.
			text: content.slice(textFrom, to),
			from: offset + match.from,
			textFrom,
			to,
		};
	},

	/**
	 * Replace a range of a plain text buffer, reporting where the cursor lands.
	 */
	edit: ({
		content,
		from,
		to,
		text,
	}: {
		content: string;
		from: number;
		to: number;
		text: string;
	}): CommandEdit => {
		const updated = content.slice(0, from) + text + content.slice(to);
		const lines = updated.slice(0, from + text.length).split("\n");
		return {
			content: updated,
			cursor: [lines.length - 1, lines[lines.length - 1].length],
		};
	},

	/**
	 * The part a command travels as, for the commands that are read from the
	 * message they were written in instead of being run.
	 */
	toNode: ({ command, value }: { command: CommandItem; value?: string }) =>
		EditorNodeUtils.command({
			name: command.name ?? "",
			value: command.value,
			argument: value,
		}),

	/**
	 * The atom a command is written into a plain text buffer as: the command as
	 * it was typed, standing for the part it travels as.
	 */
	toAtom: ({
		content,
		command,
		value,
	}: {
		content: string;
		command: CommandItem;
		value?: string;
	}) =>
		AtomUtils.fromNode({
			content,
			node: CommandUtils.toNode({ command, value }),
		}),

	/**
	 * Write a chosen command into a plain text buffer: run it, wait for its
	 * argument, or leave it for the message. Pass `complete` to only write out
	 * the command's name.
	 */
	applyCommand: ({
		content,
		query,
		command,
		complete,
	}: {
		content: string;
		query: CommandQuery;
		command: CommandItem;
		complete?: boolean;
	}): CommandEdit => {
		const { from, to } = query;

		if (CommandUtils.acceptsContent(command)) {
			return CommandUtils.edit({
				content,
				from,
				to,
				text: `/${command.name} `,
			});
		}

		if (complete) {
			return CommandUtils.edit({ content, from, to, text: `/${command.name}` });
		}

		if (CommandUtils.run({ command })) {
			return CommandUtils.edit({ content, from, to, text: "" });
		}

		return CommandUtils.edit({
			content,
			from,
			to,
			text: CommandUtils.toAtom({ content, command }),
		});
	},

	/**
	 * Write a chosen choice into a plain text buffer. Pass `complete` to only
	 * write out the choice's name.
	 */
	applyChoice: ({
		content,
		query,
		choice,
		complete,
	}: {
		content: string;
		query: CommandQuery;
		choice: CommandChoiceItem;
		complete?: boolean;
	}): CommandEdit | null => {
		const { command, from, to } = query;
		if (!command) return null;

		if (complete) {
			return CommandUtils.edit({
				content,
				from,
				to,
				text: `/${command.name} ${choice.name}`,
			});
		}

		if (CommandUtils.runChoice({ command, choice })) {
			return CommandUtils.edit({ content, from, to, text: "" });
		}

		return CommandUtils.edit({
			content,
			from,
			to,
			text: CommandUtils.toAtom({ content, command, value: choice.name }),
		});
	},

	/**
	 * Write the argument typed for a command into a plain text buffer, for
	 * commands that take free text or when there is nothing left to choose.
	 */
	applyContent: ({
		content,
		query,
	}: {
		content: string;
		query: CommandQuery;
	}): CommandEdit | null => {
		const { command, from, to, text } = query;
		if (!command) return null;

		const value = text.trim();

		if (CommandUtils.run({ command, value })) {
			return CommandUtils.edit({ content, from, to, text: "" });
		}

		if (!value || CommandUtils.needsRun(command)) return null;

		return CommandUtils.edit({
			content,
			from,
			to,
			text: CommandUtils.toAtom({ content, command, value }),
		});
	},
} as const;
