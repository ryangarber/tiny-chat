import { useAtomStore } from "#client/features/editor/stores/useAtomStore.ts";
import {
	type EditorPart,
	useEditorPartStore,
} from "#client/features/editor/stores/useEditorPartStore.ts";
import type {
	Atom,
	AtomKind,
	AtomText,
	AtomToken,
} from "#client/features/editor/types/atom.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { zData } from "#core/features/data/types/part.ts";
import {
	EditorPartUtils,
	type EditorRun,
} from "#core/features/data/utils/EditorPartUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/**
 * Atoms: the runs of a plain text buffer that stand in for the parts a message
 * carries.
 *
 * A command, an attachment and a long paste all read badly in an input — a
 * directive is unreadable, and a pasted file is unusable — so the buffer holds
 * a short stand-in for each of them and the part itself is kept alongside, in
 * {@link useEditorPartStore}. {@link AtomUtils.toData} cuts the buffer into the
 * text and the parts it is written as, and {@link AtomUtils.fromData} writes a
 * message back out as a buffer when it is loaded for editing.
 */
export const AtomUtils = {
	/** Every atom currently standing in the input. */
	atoms: () => useAtomStore.getState().atoms,

	/**
	 * Take an atom into the registry and report the text that stands for it in
	 * the buffer.
	 *
	 * The same part always comes back as the same atom, and two atoms never
	 * share the text they stand as — otherwise one would be serialized as the
	 * other. Pass `content` to drop the atoms it no longer holds.
	 */
	register: ({
		content,
		kind,
		text,
		id,
	}: {
		content?: string;
		kind: AtomKind;
		text: AtomText;
		id: string;
	}): string => {
		const { setAtoms } = useAtomStore.getState();

		const atoms = AtomUtils.atoms().filter(
			(atom) => content === undefined || content.includes(atom.text),
		);

		const existing = atoms.find((atom) => atom.kind === kind && atom.id === id);
		if (existing) {
			setAtoms(atoms);
			return existing.text;
		}

		let unique = "";
		for (let index = 0; !unique; index++) {
			const candidate = text(index);
			if (!atoms.some((atom) => atom.text === candidate)) unique = candidate;
		}

		setAtoms([...atoms, { kind, text: unique, id }]);

		return unique;
	},

	/** The atom a run of the buffer stands for, or null when it stands alone. */
	find: ({ atoms, text }: { atoms: Atom[]; text: string }) =>
		atoms.find((atom) => atom.text === text) ?? null,

	/**
	 * Matches every atom in a buffer. Longer atoms are tried first, so one that
	 * starts with another is still taken whole. Null when there are none.
	 */
	pattern: ({ atoms }: { atoms: Atom[] }): RegExp | null => {
		if (!atoms.length) return null;

		const alternation = [...atoms]
			.sort((a, b) => b.text.length - a.text.length)
			.map((atom) => CommonUtils.escapeRegex(atom.text))
			.join("|");

		return new RegExp(alternation, "g");
	},

	/** Every atom standing in a buffer, in order. */
	tokens: ({
		content,
		atoms,
	}: {
		content: string;
		atoms: Atom[];
	}): AtomToken[] => {
		const pattern = AtomUtils.pattern({ atoms });
		if (!pattern) return [];

		return [...content.matchAll(pattern)].flatMap((match) => {
			const atom = AtomUtils.find({ atoms, text: match[0] });
			if (!atom) return [];
			return {
				...atom,
				start: match.index,
				end: match.index + match[0].length,
			};
		});
	},

	/**
	 * The buffer with every atom blanked out, character for character, so that
	 * what is being typed can be read out of it without a command or a file name
	 * standing inside an atom being taken for one.
	 */
	mask: ({ content, atoms }: { content: string; atoms: Atom[] }) => {
		const pattern = AtomUtils.pattern({ atoms });
		if (!pattern) return content;

		return content.replace(pattern, (match) => match.replace(/[^\n]/g, " "));
	},

	/**
	 * The buffer as the message it is written as: the text between the atoms,
	 * and the part each atom stands for. An atom whose part has gone out of the
	 * registry is left as the text it stands as.
	 */
	toData: ({
		content,
		atoms: given,
	}: {
		content: string;
		atoms?: Atom[];
	}): EditorRun => {
		const atoms = given ?? AtomUtils.atoms();
		const { parts } = useEditorPartStore.getState();

		const run: EditorRun = [];
		const text = (value: string) => {
			const stripped = EditorPartUtils.strip(value);
			const previous = run[run.length - 1];
			if (!stripped) return;
			if (previous?.type === "text") previous.value += stripped;
			else
				run.push({
					id: CommonUtils.getRandomId(),
					type: "text",
					value: stripped,
				});
		};

		let cursor = 0;
		for (const token of AtomUtils.tokens({ content, atoms })) {
			text(content.slice(cursor, token.start));
			cursor = token.end;

			const part = parts[token.id];
			if (part?.type === token.kind) run.push(part);
			else text(content.slice(token.start, token.end));
		}
		text(content.slice(cursor));

		return run;
	},

	/** Adapt a shared editor node to the short stand-in used by a plain buffer. */
	fromNode: ({ content, node }: { content: string; node: EditorNode }) => {
		const part = useEditorPartStore.getState().parts[node.id];
		if (part?.type !== node.type) return "";
		return AtomUtils.fromPart({ content, part });
	},

	/**
	 * The inverse of {@link AtomUtils.toData}: a message as a buffer, each of
	 * its parts standing in it as an atom. Replaces both registries, since the
	 * atoms and the parts the buffer this one takes over from held are gone
	 * with it.
	 */
	fromData: (data: zData) => {
		const run = data.flat().filter(EditorPartUtils.isRun);

		useAtomStore.getState().setAtoms([]);
		useEditorPartStore.getState().setParts(run.filter(EditorPartUtils.is));

		return run
			.map((part) =>
				part.type === "text"
					? EditorPartUtils.strip(part.value)
					: AtomUtils.fromPart({ part }),
			)
			.join("");
	},

	/**
	 * The stand-in a part reads as in a plain buffer: an attachment as its name,
	 * a command as it was typed, a quote and a paste as what they hold.
	 */
	fromPart: ({
		content,
		part,
	}: {
		content?: string;
		part: EditorPart;
	}): string => {
		if (part.type === "attachment") {
			// An upload is mounted under its id, which reads as nothing at all, so
			// one carries a label and stands as that instead of as its path.
			const path = part.label
				? [part.label]
				: part.source.split(/[\\/]+/).filter(Boolean);
			const trailing = part.content.type === "directory" ? "/" : "";

			return AtomUtils.register({
				content,
				kind: "attachment",
				id: part.id,
				// Two files of the same name are told apart by as much of their
				// path as it takes.
				text: (index) => {
					if (index < path.length) {
						return `@${path.slice(path.length - index - 1).join("/")}${trailing}`;
					}
					return `@${PathUtils.name({ path })}${trailing} #${index - path.length + 2}`;
				},
			});
		}

		if (part.type === "command") {
			const written = `/${part.name}${part.argument ? ` ${part.argument}` : ""}`;
			return AtomUtils.register({
				content,
				kind: "command",
				id: part.id,
				text: (index) => (index ? `${written} #${index + 1}` : written),
			});
		}

		if (part.type === "quote") {
			const model =
				part.model ??
				(part.source ? PathUtils.name(part.source) : undefined) ??
				"message";
			return AtomUtils.register({
				content,
				kind: "quote",
				id: part.id,
				text: (index) =>
					index ? `[Quoted ${model} #${index + 1}]` : `[Quoted ${model}]`,
			});
		}

		const written = `[${part.lines} pasted lines]`;
		return AtomUtils.register({
			content,
			kind: "paste",
			id: part.id,
			text: (index) =>
				index ? `[${part.lines} pasted lines #${index + 1}]` : written,
		});
	},
} as const;
