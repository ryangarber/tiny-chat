import { useCallback, useMemo, useState } from "react";
import { useToolFeedback } from "#client/features/part/hooks/useToolFeedback.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zToolCallPart } from "#core/features/data/types/part.ts";
import type { ToolControls as ToolControlsType } from "#core/features/tool/types/display.ts";
import Box from "#tui/core/components/Box.tsx";
import Completions from "#tui/core/components/Completions.tsx";
import Panel, { useFocused } from "#tui/core/components/Panel.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import Textarea from "#tui/features/textarea/components/Textarea.tsx";

interface Item {
	name?: string;
	value: string;
	field?: string;
	/** An option's label, which picking it sends. */
	option?: string;
	description?: string;
	multiple?: boolean;
	custom?: boolean;
	/** Its place among the field's choices, as it is numbered. */
	number?: number;
	approved?: boolean;
	submit?: boolean;
}

/**
 * Each field's options, then its write-in, precede the approval/continue
 * choices; a field asking one of several questions is headed by it. Any call
 * waiting on feedback, and not yet answered, can take the focus.
 */
export default function ToolControls({
	message,
	part,
	controls,
	answerable = false,
}: {
	message: MessageState;
	part: zToolCallPart;
	controls: ToolControlsType;
	answerable?: boolean;
}) {
	const id = `tool:${part.id}` as const;
	const setFocus = useAppStore((state) => state.setFocus);
	const {
		values,
		setValue,
		toggle,
		isPicked,
		answers,
		submit,
		locked,
		complete,
		mutation,
	} = useToolFeedback({
		message,
		part,
		controls,
	});
	useWorkingStatus(mutation);
	const disabled = locked || !answerable;
	const focused = useFocused(id) && !disabled;

	const [selected, setSelected] = useState(0);
	// Completions resets to the first item whenever this changes identity.
	const updateSelected = useCallback(
		(update: (previous?: number) => number) =>
			setSelected((previous) => update(previous)),
		[],
	);
	// One question with one answer to pick: choosing it is sending it, as in
	// Claude Code, so there is no separate action to move on to.
	const quick =
		!controls.approval &&
		controls.fields.length === 1 &&
		!controls.fields[0]?.multiple;
	const groups = useMemo(() => {
		// Numbered through every field, as the digit keys count them.
		let count = 0;
		const fields = controls.fields.map((field) => ({
			name: [field.header, field.label].filter(Boolean).join(": ") || undefined,
			items: [
				...field.options.map(
					(option): Item => ({
						name: option.label,
						value: `option:${field.name}:${option.label}`,
						field: field.name,
						option: option.label,
						description: option.description,
						multiple: field.multiple,
						number: ++count,
					}),
				),
				...(field.custom
					? [
							{
								value: `custom:${field.name}`,
								field: field.name,
								custom: true,
								number: ++count,
							} satisfies Item,
						]
					: []),
			],
		}));
		if (quick) return fields;
		const actions: Item[] = controls.approval
			? [
					{ name: "approve", value: "approve", submit: true, approved: true },
					{ name: "deny", value: "deny", submit: true, approved: false },
				]
			: [{ name: "continue", value: "continue", submit: true }];
		return [...fields, { name: undefined, items: actions }];
	}, [controls, quick]);

	return (
		<Panel id={id} disabled={disabled}>
			<Completions<{ items: Item[] }, Item>
				groups={groups}
				numbered
				selected={selected}
				setSelected={updateSelected}
				renderItem={({ item, selected: isSelected }) => {
					if (item.custom && item.field) {
						const field = item.field;
						return (
							<Box gap={1}>
								<Text color="textSubtle">{item.number}.</Text>
								<Textarea
									focus={focused && isSelected}
									styles={
										!focused ? { text: { color: "textSubtle" } } : undefined
									}
									value={values[field] ?? ""}
									onChange={(value) => setValue(field, value)}
									// Enter moves on to the submit action rather than breaking the line.
									onEnter={() => {}}
									placeholder={
										controls.fields.find((entry) => entry.name === field)
											?.placeholder ?? "Something else..."
									}
								/>
							</Box>
						);
					}
					if (item.field && item.option !== undefined) {
						const picked = isPicked(item.field, item.option);
						const mark = item.multiple ? (picked ? "[x] " : "[ ] ") : "";
						return (
							<Box flexDirection="column">
								<Text color={!focused ? "textSubtle" : undefined}>
									{item.number}. {mark}
									{item.option}
									{picked && !item.multiple && !quick ? " ✓" : ""}
								</Text>
								{item.description && (
									<Text color="textSubtle">{item.description}</Text>
								)}
							</Box>
						);
					}
					// Deny can be sent without filling the fields; approve and continue cannot.
					const unavailable =
						item.submit && item.approved !== false && !complete;
					return (
						<Text color={!focused || unavailable ? "textSubtle" : undefined}>
							{item.name}
						</Text>
					);
				}}
				onInput={({ item, input, key, pointer }) => {
					// Digits are typed into a write-in, not jumped to.
					if (item?.custom && /^\d$/.test(input)) return false;
					// Shift and the arrows belong to the textarea's text selection.
					if (key.shift) return false;
					// Clicking a textarea positions its cursor, not the submit action.
					if (pointer && item?.custom) return false;

					if (key.return && item) {
						if (item.field) {
							if (quick) {
								const answer = item.custom
									? (values[item.field] ?? "").trim()
									: item.option;
								if (!answer) return false;
								setFocus("editor");
								submit(undefined, { [item.field]: answer });
								return false;
							}
							if (item.custom) {
								setSelected(
									groups
										.flatMap((group) => group.items)
										.findIndex((entry) => entry.submit),
								);
								return false;
							}
							if (item.option === undefined) return false;
							if (item.multiple) toggle(item.field, item.option);
							else setValue(item.field, item.option);
							return false;
						}
						if (!item.submit) return false;
						if (item.approved !== false && !complete) {
							const position = groups
								.flatMap((group) => group.items)
								.findIndex((entry) =>
									controls.fields.some(
										(field) =>
											field.name === entry.field && !answers[field.name],
									),
								);
							if (position >= 0) setSelected(position);
							return false;
						}
						setFocus("editor");
						submit(item.approved);
						return false;
					}
				}}
				actions={["select"]}
			/>
		</Panel>
	);
}
