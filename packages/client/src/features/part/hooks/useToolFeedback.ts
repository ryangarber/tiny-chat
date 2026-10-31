import { useCallback, useMemo, useState } from "react";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import { useToolFeedbackStore } from "#client/features/part/stores/useToolFeedbackStore.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zToolCallPart } from "#core/features/data/types/part.ts";
import type { ToolControls } from "#core/features/tool/types/display.ts";

/**
 * The state behind a tool call's controls: what the user has filled in, and
 * sending it. Fields are sent as one object keyed by each field's `name`.
 */
export const useToolFeedback = ({
	message,
	part,
	controls,
}: {
	message: MessageState;
	part: zToolCallPart;
	controls: ToolControls;
}) => {
	const { sendToolFeedback } = useMessaging();

	const [values, setValues] = useState<Record<string, string>>({});
	/** Options picked on fields that take several, beside anything written in. */
	const [picks, setPicks] = useState<Record<string, string[]>>({});

	const setValue = useCallback((name: string, value: string) => {
		setValues((previous) => ({ ...previous, [name]: value }));
	}, []);

	/** Picks or unpicks an option of a field that takes several. */
	const toggle = useCallback((name: string, option: string) => {
		setPicks((previous) => {
			const picked = previous[name] ?? [];
			return {
				...previous,
				[name]: picked.includes(option)
					? picked.filter((entry) => entry !== option)
					: [...picked, option],
			};
		});
	}, []);

	const isPicked = useCallback(
		(name: string, option: string) =>
			(picks[name] ?? []).includes(option) || values[name] === option,
		[picks, values],
	);

	/** Each field's answer as it is sent. */
	const answers = useMemo(
		() =>
			Object.fromEntries(
				controls.fields.map((field) => [
					field.name,
					field.multiple
						? [...(picks[field.name] ?? []), values[field.name]?.trim()]
								.filter(Boolean)
								.join(", ")
						: (values[field.name] ?? ""),
				]),
			),
		[controls, picks, values],
	);

	const answered = useToolFeedbackStore((state) => state.answered.has(part.id));

	// Nothing can be sent twice: the controls stay locked from the moment
	// feedback is sent until the call it answers has settled. An answer sent
	// while a generation is busy elsewhere is held until it gets to the call.
	const locked = sendToolFeedback.isPending || answered;

	const complete = controls.fields.every((field) => !!answers[field.name]);

	const submit = useCallback(
		(approved?: boolean, overrides?: Record<string, string>) => {
			const feedback = { ...answers, ...overrides };
			sendToolFeedback.mutate({
				seed: message,
				part,
				approved: controls.approval ? approved : undefined,
				feedback: controls.fields.length ? feedback : undefined,
			});
		},
		[answers, message, part, controls, sendToolFeedback],
	);

	return {
		values,
		setValue,
		toggle,
		isPicked,
		answers,
		submit,
		locked,
		complete,
		mutation: sendToolFeedback,
		/** Which choice is being sent, for a spinner on the right button. */
		sending: sendToolFeedback.isPending
			? (sendToolFeedback.variables?.approved ?? true)
			: undefined,
	};
};
