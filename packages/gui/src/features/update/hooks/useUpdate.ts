import { useMutation, useQuery } from "@tanstack/react-query";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import type { RuntimeUpdate } from "#gui/core/types/runtime.ts";
import { useUpdateStore } from "#gui/features/update/stores/useUpdateStore.ts";

export const useUpdate = () => {
	const runtime = useRuntime();
	const dismissedUpdate = useUpdateStore((state) => state.dismissedUpdate);

	const update = useQuery({
		queryKey: ["useUpdate", "update", runtime.platform],
		queryFn: async (): Promise<RuntimeUpdate | null> => {
			if (!runtime.update || import.meta.env.DEV) return null;

			const update = await runtime.update.check();
			if (update?.version && update.version !== dismissedUpdate) {
				return update;
			}

			return null;
		},
	});

	const installUpdate = useMutation({
		mutationFn: async (update: RuntimeUpdate) => {
			if (!runtime.update) return;

			// TODO - move
			void useUpdateStore
				.getState()
				.addTask(
					"update",
					`Downloading v${update.version}`,
					"App will update and restart",
				);

			try {
				// Relaunches the app once installed; restart must not depend on
				// animation frames, which can be suspended while it is hidden.
				await runtime.update.install({
					onProgress: (fraction) =>
						void useUpdateStore.getState().updateTask("update", fraction * 100),
				});
			} finally {
				void useUpdateStore.getState().removeTask("update");
			}
		},
	});

	return { update, installUpdate };
};
