import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { UserService } from "#client/features/user/services/UserService.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { ActionState } from "#core/features/data/types/action.ts";
import type { zData } from "#core/features/data/types/part.ts";

/** A prompt as an action sends it, the way `edit_actions` writes it. */
const toData = (prompt: string): zData => [
	[{ id: CommonUtils.getRandomId(), type: "text", value: prompt }],
];

/** An action as it is written by hand: a prompt, and when to send it. */
export interface ActionDraft {
	prompt: string;
	/** An RRule in wall-clock time, as `CommonUtils.parseSchedule` reads it. */
	schedule: string;
}

export const useActions = () => {
	const client = useContext(ClientContext);

	const actions = useQuery({
		...client.query.action.getActions.queryOptions(),
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const onSuccess = () => UserService.fetchActions({ client });

	/** Where a new action is scheduled: its times are wall-clock times here. */
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	/** An action runs on in the chat of the message it was scheduled from. */
	const createAction = useMutation({
		mutationFn: ({
			message,
			prompt,
			schedule,
		}: ActionDraft & { message: string }) =>
			client.api.action.createAction.mutate({
				message,
				schedule,
				timezone,
				data: toData(prompt),
			}),
		onSuccess,
	});

	const updateAction = useMutation({
		// Rescheduled where it was scheduled, so its times keep their meaning.
		mutationFn: ({
			action,
			prompt,
			schedule,
		}: Partial<ActionDraft> & { action: ActionState }) =>
			client.api.action.updateAction.mutate({
				id: action.id,
				message: action.messageId,
				schedule: schedule ?? action.schedule,
				timezone: action.timezone,
				data: prompt === undefined ? action.data : toData(prompt),
			}),
		onSuccess,
	});

	const deleteAction = useMutation({
		...client.query.action.deleteAction.mutationOptions(),
		onSuccess,
	});

	return { actions, timezone, createAction, updateAction, deleteAction };
};
