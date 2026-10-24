import { useEffect, useState } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { useActions } from "#client/features/user/hooks/useActions.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import Text from "#tui/core/components/Text.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import Details from "#tui/features/settings/components/Details.tsx";
import TextList, {
	type Draft,
} from "#tui/features/settings/components/TextList.tsx";

type Route = "prompt" | "schedule";

/** Prompts sent on a schedule, written and rescheduled in place. */
export default function Actions() {
	const { actions, timezone, createAction, updateAction, deleteAction } =
		useActions();
	useWorkingStatus(actions, createAction, updateAction, deleteAction);

	// An action runs on in the chat it was scheduled from, after its last message.
	const { messages } = useMessages();
	const lastMessageId = messages.data?.messages.at(-1)?.id;

	const items = [...(actions.data ?? [])].sort(
		(a, b) =>
			CommonUtils.toDate(b.createdAt).getTime() -
			CommonUtils.toDate(a.createdAt).getTime(),
	);

	const [draft, setDraft] = useState<Draft | null>(null);
	// Looked up afresh so the editor shows a change as soon as it lands.
	// Opened on the one a source was edited from, if it was.
	const [editingId, setEditingId] = useState<string | null>(
		() => useLayoutStore.getState().record,
	);
	const clearRecord = useAppStore((state) => state.clearRecord);
	useEffect(() => clearRecord(), [clearRecord]);
	const editing = items.find((action) => action.id === editingId);
	const [route, setRoute] = useState<Route | null>(null);
	const [selected, setSelected] = useState(0);
	/** A prompt written for a new action, waiting on its schedule. */
	const [pending, setPending] = useState<string | null>(null);
	/** A schedule that couldn't be read, kept to be corrected. */
	const [invalid, setInvalid] = useState<string | null>(null);

	/** Opens the schedule written afresh, the one in effect standing in until it is. */
	const schedule = () => {
		setInvalid(null);
		setDraft({ index: 0, text: "" });
	};

	usePage({
		// A draft takes `back` first, then the field, then the action.
		onBack: () => {
			if (draft) setDraft(null);
			else if (pending !== null) setPending(null);
			else if (route) setRoute(null);
			else if (editing) setEditingId(null);
			else return;
			return false;
		},
	});

	if (pending !== null || (editing && route === "schedule")) {
		const current = CommonUtils.describeSchedule(editing?.schedule);
		const prompt =
			pending ??
			(editing && ChatSourcesUtils.action({ action: editing }).prompt);
		return (
			<TextList
				entries={[
					{
						label: "schedule",
						text: invalid ?? current,
						detail:
							invalid === null ? undefined : "couldn't read that schedule",
						error: invalid !== null,
					},
				]}
				draft={draft}
				setDraft={setDraft}
				placeholder={current || "every weekday at 9am"}
				before={<Text color="textSubtle">{prompt}</Text>}
				onEdit={(_, text) => {
					// Left empty, an action keeps the schedule it has.
					if (!text && editing) return setRoute(null);
					const parsed = CommonUtils.parseSchedule({
						text,
						timezone: editing?.timezone ?? timezone,
					});
					if (!parsed) return setInvalid(text);
					if (pending !== null) {
						if (lastMessageId)
							createAction.mutate({
								message: lastMessageId,
								prompt: pending,
								schedule: parsed,
							});
						setPending(null);
					} else if (editing) {
						updateAction.mutate({ action: editing, schedule: parsed });
						setRoute(null);
					}
				}}
			/>
		);
	}

	if (editing && route === "prompt") {
		const { prompt } = ChatSourcesUtils.action({ action: editing });
		return (
			<TextList
				entries={[{ label: "prompt", text: prompt }]}
				draft={draft}
				setDraft={setDraft}
				placeholder="Summarize the news."
				onEdit={(_, text) => {
					if (text) updateAction.mutate({ action: editing, prompt: text });
				}}
			/>
		);
	}

	if (editing) {
		const {
			prompt,
			schedule: described,
			lastRun,
			nextRun,
		} = ChatSourcesUtils.action({ action: editing });
		return (
			<Details
				groups={[
					{
						items: [
							{
								name: "prompt",
								value: "prompt",
								state: prompt,
								route: "prompt",
							},
							{
								name: "schedule",
								value: "schedule",
								state: described,
								route: "schedule",
							},
						],
					},
				]}
				selected={selected}
				setSelected={setSelected}
				before={
					<Text color="textSubtle">
						{[nextRun, lastRun].filter(Boolean).join(" · ")}
					</Text>
				}
				onOpen={(next) => {
					setRoute(next as Route);
					if (next === "schedule") schedule();
				}}
				remove={{
					name: "delete",
					label: "delete this action?",
					run: () =>
						deleteAction.mutate(
							{ id: editing.id },
							{ onSuccess: () => setEditingId(null) },
						),
				}}
			/>
		);
	}

	return (
		<TextList
			entries={items.map((action) => {
				const { prompt, schedule, nextRun } = ChatSourcesUtils.action({
					action,
				});
				return {
					text: prompt,
					detail: [schedule, nextRun?.toLowerCase()]
						.filter(Boolean)
						.join(" · "),
				};
			})}
			draft={draft}
			setDraft={setDraft}
			placeholder="Summarize the news."
			before={
				lastMessageId ? undefined : (
					<Text color="textSubtle">
						Send a message first to schedule an action from this chat.
					</Text>
				)
			}
			// Scheduled once it is written, from the chat it was written in.
			onAdd={
				lastMessageId
					? (prompt) => {
							setPending(prompt);
							schedule();
						}
					: undefined
			}
			onEdit={(index, prompt) =>
				updateAction.mutate({ action: items[index], prompt })
			}
			onRemove={(index) => deleteAction.mutate({ id: items[index].id })}
			removeName="delete"
			onSelect={(index) => {
				setEditingId(items[index].id);
				setSelected(() => 0);
			}}
			selectName="open"
		/>
	);
}
