import { type ReactNode, useState } from "react";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import HelpText from "#tui/core/components/HelpText.tsx";
import { usePanel } from "#tui/core/components/Panel.tsx";
import Text from "#tui/core/components/Text.tsx";
import type { Bindings } from "#tui/core/utils/ListBindingUtils.ts";
import Completions from "#tui/features/editor/components/Completions.tsx";
import type { ChoiceItem } from "#tui/features/settings/components/Choice.tsx";
import Textarea from "#tui/features/textarea/components/Textarea.tsx";

export interface TextEntry {
	/** Names the entry when the list is fixed, such as a provider's settings. */
	label?: string;
	text: string;
	detail?: string;
	error?: boolean;
}

/** `null` is the row that adds an entry. */
export type Draft = { index: number | null; text: string };

interface TextItem extends ChoiceItem {
	index: number | null;
	entry?: TextEntry;
}

/**
 * A submenu over a list of texts — instructions, commands, folders, keys —
 * each written in place where it is listed: Enter writes one (unless
 * `onSelect` takes it), `e` always does, `n` writes a new one. A text is
 * saved by Enter, or a press on its `save` hint, and nothing else.
 *
 * The draft lives with the page so that going back cancels it first.
 */
export default function TextList({
	entries,
	draft,
	setDraft,
	placeholder,
	onAdd,
	onEdit,
	onRemove,
	removeName = "remove",
	onSelect,
	selectName,
	bindings,
	mask,
	before,
}: {
	entries: TextEntry[];
	draft: Draft | null;
	setDraft: (draft: Draft | null) => void;
	placeholder: string;
	/** Left out when the list is a fixed set. */
	onAdd?: (text: string) => void;
	onEdit?: (index: number, text: string) => void;
	/** Left out when its entries cannot be dropped. */
	onRemove?: (index: number) => void;
	/** `delete` when the entry is gone for good, not just off the list. */
	removeName?: "delete" | "remove";
	/** Takes the place of editing on `enter`, `e` still writing the entry. */
	onSelect?: (index: number) => void;
	/** What `onSelect` does, as the help puts it. */
	selectName?: string;
	/** The other verbs an entry answers to, given its index. */
	bindings?: Pick<Bindings<number>, "toggle" | "reorder" | "refresh" | "edit">;
	/** Hides all but the end of a text that is not being written. */
	mask?: boolean;
	before?: ReactNode;
}) {
	const [selected, setSelected] = useState(0);
	// In a panel, a draft takes the keys only while the panel has them.
	const { focused } = usePanel();

	const groups: CompletionGroup<TextItem>[] = [
		{
			items: [
				...entries.map(
					(entry, index): TextItem => ({
						name: entry.label ?? entry.text,
						value: `${index}:${entry.label ?? entry.text}`,
						index,
						entry,
					}),
				),
				...(onAdd
					? [{ name: "add", value: "add", index: null } satisfies TextItem]
					: []),
			],
		},
	];

	const write = (index: number | null) => {
		setDraft({ index, text: index === null ? "" : entries[index].text });
		// The draft is written where the cursor is.
		setSelected(() => (index === null ? entries.length : index));
	};

	/** An index verb, which the row that adds an entry has none of. */
	const atIndex = (binding?: {
		run: (index: number) => void;
		when?: (index: number) => boolean;
	}) =>
		binding && {
			run: (item: TextItem) => {
				if (item.index !== null) binding.run(item.index);
			},
			when: (item: TextItem) =>
				item.index !== null && (binding.when?.(item.index) ?? true),
		};

	const edit = bindings?.edit ?? (onEdit ? { run: write } : undefined);
	const reorder = bindings?.reorder;

	const commit = (value: string) => {
		if (!draft) return;
		const text = value.trim();
		const { index } = draft;
		setDraft(null);
		if (index === null) {
			if (text) onAdd?.(text);
			return;
		}
		if (text === entries[index]?.text) return;
		if (text || !onRemove) onEdit?.(index, text);
		else onRemove(index);
	};

	return (
		<Completions<{ items: TextItem[] }, TextItem>
			groups={groups}
			selectFirstOnChange={false}
			before={before}
			// The text area wraps to the width it is given; a row sized to its
			// content would give it only what it already holds.
			itemProps={{ flexGrow: 1, flexShrink: 1 }}
			selected={selected}
			setSelected={(update) => setSelected(update)}
			// The text area takes every key while a draft is open.
			onInput={() => (draft ? false : undefined)}
			bindings={{
				primary: {
					name: (item) =>
						item.index === null
							? "add"
							: onSelect
								? (selectName ?? "select")
								: "edit",
					run: (item) => {
						if (item.index === null) write(null);
						else if (onSelect) onSelect(item.index);
						else edit?.run(item.index);
					},
					when: (item) => item.index === null || !!onSelect || !!edit,
				},
				toggle: atIndex(bindings?.toggle),
				edit: atIndex(edit),
				create: onAdd && { run: () => write(null) },
				remove: onRemove && {
					name: removeName,
					run: (item) => {
						if (item.index !== null) onRemove(item.index);
					},
					when: (item) => item.index !== null,
				},
				reorder: reorder && {
					run: (item, direction) => {
						if (item.index !== null) reorder.run(item.index, direction);
					},
					when: (item) =>
						item.index !== null && (reorder.when?.(item.index) ?? true),
				},
				refresh: bindings?.refresh && {
					run: (item) => bindings.refresh?.run(item?.index ?? undefined),
				},
			}}
			renderItem={({ item, selected }) => {
				const editing = draft?.index === item.index && draft !== null;
				if (editing && draft) {
					return (
						<>
							{item.entry?.label && <Text>{item.entry.label}</Text>}
							<Textarea
								focus={selected && focused}
								value={draft.text}
								onChange={(text) => setDraft({ ...draft, text })}
								// An entry is committed by Enter, under a modifier or not.
								onEnter={() => commit(draft.text)}
								onSubmit={commit}
								placeholder={placeholder}
							/>
						</>
					);
				}
				if (!item.entry) return <Text color="textSubtle">+ {placeholder}</Text>;
				const { label, text, detail, error } = item.entry;
				const shown =
					mask && text
						? `${"•".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`
						: text;
				return (
					<>
						{label && <Text>{label}</Text>}
						<Text color={error ? "redBright" : label ? "text" : undefined}>
							{shown || (label ? "(none)" : "")}
							{detail && <Text color="textSubtle"> · {detail}</Text>}
						</Text>
					</>
				);
			}}
			renderEmpty={() => "nothing here yet"}
			actions={["back"]}
			// A list's verbs wait on the draft, which only saves or cancels.
			help={!draft}
			after={
				draft && (
					<HelpText
						actions={[
							{ key: "enter", name: "save", onClick: () => commit(draft.text) },
							{ key: "esc", name: "cancel", onClick: () => setDraft(null) },
						]}
					/>
				)
			}
		/>
	);
}
