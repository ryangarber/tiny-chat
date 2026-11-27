import {
	ActionIcon,
	Box,
	Group,
	Paper,
	Stack,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useLaunchSettings } from "#client/features/settings/hooks/useLaunchSettings.ts";
import type { ProjectLike } from "#core/features/data/types/chat.ts";
import type { zLaunch } from "#core/features/data/types/user.ts";
import SaveButton from "#gui/core/components/SaveButton.tsx";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import { StyleUtils } from "#gui/core/utils/StyleUtils.ts";

function Launch({
	project,
	launch,
}: {
	project: ProjectLike;
	launch: zLaunch;
}) {
	// Its own mutations, so only this launch waits on them.
	const { updateLaunch, removeLaunch } = useLaunchSettings({ project });
	const [name, setName] = useState(launch.name);
	const [script, setScript] = useState(launch.script);
	const dirty =
		(name.trim() && name.trim() !== launch.name) ||
		(script.trim() && script.trim() !== launch.script);
	const pending = updateLaunch.isPending || removeLaunch.isPending;

	const save = () => {
		if (!dirty) return;
		updateLaunch.mutate({
			project,
			id: launch.id,
			launch: {
				name: name.trim() || launch.name,
				script: script.trim() || launch.script,
			},
		});
	};

	return (
		<Paper withBorder p="xs">
			<Stack gap={6}>
				<Group gap={4} wrap="nowrap">
					<TextInput
						flex={1}
						size="xs"
						value={name}
						aria-label="Launch name"
						onChange={(e) => setName(e.target.value)}
						onKeyDown={ControlUtils.onEnter(save)}
						disabled={pending}
					/>
					<SaveButton
						dirty={!!dirty}
						loading={updateLaunch.isPending}
						disabled={pending}
						onClick={save}
					/>
					<ActionIcon
						variant="subtle"
						aria-label={`Remove ${launch.name}`}
						onClick={() => removeLaunch.mutate({ project, id: launch.id })}
						loading={removeLaunch.isPending}
						disabled={pending}
					>
						<TrashIcon size={20} />
					</ActionIcon>
				</Group>
				<TextInput
					size="xs"
					ff="monospace"
					value={script}
					aria-label="Launch script"
					onChange={(e) => setScript(e.target.value)}
					onKeyDown={ControlUtils.onEnter(save)}
					disabled={pending}
				/>
			</Stack>
		</Paper>
	);
}

/** A project's launches: scripts the app runs, and the agent can control. */
export default function LaunchSettings({ project }: { project: ProjectLike }) {
	const { launches, addLaunch } = useLaunchSettings({ project });
	const [name, setName] = useState("");
	const [script, setScript] = useState("");

	const add = () => {
		const value = script.trim();
		if (!value) return;
		addLaunch.mutate(
			{ project, launch: { name: name.trim() || value, script: value } },
			{
				onSuccess: () => {
					setName("");
					setScript("");
				},
			},
		);
	};

	return (
		<>
			<Box>
				<Text size="sm">Launches</Text>
				<Text size="xs" c="dimmed">
					Scripts to run and keep an eye on, from the sources panel or by the
					agent
				</Text>
			</Box>
			{launches.map((launch) => (
				<Launch key={launch.id} project={project} launch={launch} />
			))}
			<Tooltip label="Runs in the project's folder" position="right">
				<Stack gap={6}>
					<TextInput
						label="Name"
						styles={StyleUtils.input}
						placeholder="dev server"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={ControlUtils.onEnter(add)}
						disabled={addLaunch.isPending}
					/>
					<TextInput
						label="Script"
						styles={StyleUtils.input}
						ff="monospace"
						placeholder="pnpm dev"
						value={script}
						onChange={(e) => setScript(e.target.value)}
						onKeyDown={ControlUtils.onEnter(add)}
						rightSection={
							<SaveButton
								label="Add launch"
								dirty={!!script.trim()}
								loading={addLaunch.isPending}
								onClick={add}
							/>
						}
						disabled={addLaunch.isPending}
					/>
				</Stack>
			</Tooltip>
		</>
	);
}
