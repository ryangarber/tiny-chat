import { useLaunchSettings } from "#client/features/settings/hooks/useLaunchSettings.ts";
import type { ProjectLike } from "#core/features/data/types/chat.ts";
import { LaunchUtils } from "#core/features/tool/utils/LaunchUtils.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import TextList, {
	type Draft,
} from "#tui/features/settings/components/TextList.tsx";

/**
 * A project's launches, each written on one line as `name: script` (a line
 * without a name is named by its script).
 */
export default function LaunchSettings({
	project,
	draft,
	setDraft,
}: {
	project: ProjectLike;
	draft: Draft | null;
	setDraft: (draft: Draft | null) => void;
}) {
	const { launches, addLaunch, updateLaunch, removeLaunch } = useLaunchSettings(
		{ project },
	);
	useWorkingStatus(addLaunch, updateLaunch, removeLaunch);

	return (
		<TextList
			entries={launches.map((launch) => ({ text: LaunchUtils.format(launch) }))}
			draft={draft}
			setDraft={setDraft}
			placeholder="name: script (e.g. dev: pnpm dev)"
			onAdd={(text) => {
				const launch = LaunchUtils.parse(text);
				if (launch) addLaunch.mutate({ project, launch });
			}}
			onEdit={(index, text) => {
				const launch = LaunchUtils.parse(text);
				const id = launches[index]?.id;
				if (launch && id) updateLaunch.mutate({ project, id, launch });
			}}
			onRemove={(index) => {
				const id = launches[index]?.id;
				if (id) removeLaunch.mutate({ project, id });
			}}
		/>
	);
}
