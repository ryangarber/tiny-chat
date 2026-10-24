import {
	ActionIcon,
	Button,
	Divider,
	Group,
	Modal,
	Stack,
	Text,
	Textarea,
	TextInput,
} from "@mantine/core";
import { TrashIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { useActions } from "#client/features/user/hooks/useActions.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import SaveButton from "#gui/core/components/SaveButton.tsx";
import VirtualList from "#gui/core/components/VirtualList.tsx";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import scrollable from "#gui/core/styles/scrollable.module.css";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";

const SCHEDULE_ERROR = "Couldn't read that schedule";

const getKey = (action: ActionState) => action.id;

/** Prompts sent on a schedule, written and rescheduled in place. */
export default function Actions() {
	const { actions, timezone, createAction } = useActions();

	const currentModal = useAppStore((state) => state.currentModal);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);
	const currentRecord = useLayoutStore((state) => state.record);
	const setRecord = useLayoutStore((state) => state.setRecord);
	const clearRecord = useCallback(() => setRecord(null), [setRecord]);

	// An action runs on in the chat it was scheduled from, after its last message.
	const { messages } = useMessages();
	const lastMessageId = messages.data?.messages.at(-1)?.id;

	const [prompt, setPrompt] = useState("");
	const [schedule, setSchedule] = useState("");
	const parsed = CommonUtils.parseSchedule({ text: schedule, timezone });

	const items = useMemo(
		() =>
			[...(actions.data ?? [])].sort(
				(a, b) =>
					CommonUtils.toDate(b.createdAt).getTime() -
					CommonUtils.toDate(a.createdAt).getTime(),
			),
		[actions.data],
	);

	const create = () => {
		if (!lastMessageId || !prompt.trim() || !parsed) return;
		createAction.mutate(
			{ message: lastMessageId, prompt: prompt.trim(), schedule: parsed },
			{
				onSuccess: () => {
					setPrompt("");
					setSchedule("");
				},
			},
		);
	};

	return (
		<Modal
			opened={currentModal === "actions"}
			onClose={() => setCurrentModal(null)}
			title="Actions"
			size="lg"
			centered
			classNames={scrollable}
		>
			<Stack mih={0} flex="0 1 auto">
				<Stack gap="xs">
					<Textarea
						autosize
						minRows={2}
						maxRows={6}
						label="Prompt"
						placeholder="Summarize the news."
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						disabled={!lastMessageId || createAction.isPending}
						// Not over an action being jumped to, which the keys go to instead.
						data-autofocus={!currentRecord || undefined}
					/>
					<TextInput
						label="Schedule"
						placeholder="every weekday at 9am"
						value={schedule}
						onChange={(e) => setSchedule(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && create()}
						description={
							parsed ? CommonUtils.describeSchedule(parsed) : undefined
						}
						error={schedule.trim() && !parsed ? SCHEDULE_ERROR : undefined}
						disabled={!lastMessageId || createAction.isPending}
					/>
					<Button
						variant="default"
						onClick={create}
						loading={createAction.isPending}
						disabled={!lastMessageId || !prompt.trim() || !parsed}
					>
						Schedule
					</Button>
					{!lastMessageId && (
						<Text size="xs" c="dimmed">
							Send a message first to schedule an action from this chat.
						</Text>
					)}
				</Stack>
				{items.length > 0 && <Divider />}
				{actions.data?.length === 0 && (
					<Text size="sm" c="dimmed" ta="center">
						Nothing scheduled yet
					</Text>
				)}
				<VirtualList
					items={items}
					getKey={getKey}
					gap={16}
					renderItem={(action) => (
						<Action
							key={`${action.id}:${action.schedule}:${ChatSourcesUtils.action({ action }).prompt}`}
							action={action}
						/>
					)}
					focused={currentRecord}
					onFocused={clearRecord}
				/>
			</Stack>
		</Modal>
	);
}

function Action({ action }: { action: ActionState }) {
	// Its own mutations, so only this action waits on them.
	const { updateAction, deleteAction } = useActions();
	const busy = updateAction.isPending || deleteAction.isPending;

	const { prompt, schedule, lastRun, nextRun } = ChatSourcesUtils.action({
		action,
	});
	const [promptText, setPromptText] = useState(prompt);
	const [scheduleText, setScheduleText] = useState(schedule);
	const parsed = CommonUtils.parseSchedule({
		text: scheduleText,
		timezone: action.timezone,
	});
	const dirty = promptText.trim() !== prompt || scheduleText !== schedule;

	// The prompt and schedule are saved together, once the schedule reads.
	const save = () => {
		if (!dirty) return;
		const next = promptText.trim();
		if (!next) return deleteAction.mutate({ id: action.id });
		if (!parsed) return;
		updateAction.mutate({
			action,
			...(next !== prompt && { prompt: next }),
			...(scheduleText !== schedule && { schedule: parsed }),
		});
	};

	return (
		<Stack gap={4}>
			<Textarea
				value={promptText}
				autosize
				onChange={(e) => setPromptText(e.target.value)}
				onKeyDown={ControlUtils.onEnter(save)}
				rightSectionWidth={dirty || updateAction.isPending ? 64 : undefined}
				rightSection={
					<Group gap={0} wrap="nowrap">
						<SaveButton
							dirty={dirty}
							loading={updateAction.isPending}
							disabled={busy || (!!promptText.trim() && !parsed)}
							onClick={save}
						/>
						<ActionIcon
							variant="subtle"
							aria-label="Delete action"
							onClick={() => deleteAction.mutate({ id: action.id })}
							disabled={busy}
						>
							<TrashIcon size={20} />
						</ActionIcon>
					</Group>
				}
				disabled={busy}
			/>
			<Group gap="xs" wrap="nowrap" align="flex-start">
				<TextInput
					size="xs"
					variant="filled"
					flex={1}
					value={scheduleText}
					onChange={(e) => setScheduleText(e.target.value)}
					onKeyDown={ControlUtils.onEnter(save)}
					error={!parsed ? SCHEDULE_ERROR : undefined}
					disabled={busy}
				/>
				<Text size="xs" c="dimmed" mt={6} style={{ whiteSpace: "nowrap" }}>
					{nextRun ?? lastRun}
				</Text>
			</Group>
		</Stack>
	);
}
