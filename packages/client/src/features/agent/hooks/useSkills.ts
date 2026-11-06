import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import { ClientContext } from "#client/client.ts";
import { SkillService } from "#client/features/agent/services/SkillService.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useSettings } from "#client/features/settings/hooks/useSettings.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import { SkillUtils } from "#core/features/skill/utils/SkillUtils.ts";

export const localSkillsQueryKey = ["skills", "local"] as const;
export const nativeSkillsQueryKey = ["skills", "native"] as const;

export const useSkills = () => {
	const client = useContext(ClientContext);

	const { nextChat } = useChat();
	const { settings } = useSettings();
	const chatId = useChatStore((state) => state.active.chatId);
	const projectId = useChatStore((state) => state.active.project?.id ?? null);

	const localSkills = useQuery({
		queryKey: [
			...localSkillsQueryKey,
			chatId,
			projectId,
			nextChat.project?.settings?.folders,
			settings.data?.folders,
		],
		queryFn: async () => {
			const shell = client.shell;
			if (!shell) return [];

			// Activation resolves the primary folder on this device and moves the
			// shell there. Never discover relative to the previous chat's folder.
			await client.workingDirectory.ready();
			return SkillService.discover({
				shell,
				primaryFolder: await shell.cwd?.(),
			});
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const nativeSkills = useQuery({
		queryKey: nativeSkillsQueryKey,
		queryFn: async () => {
			const skills: zSkill[] = [];

			const remoteSkills = await client.api.upload.getSkills.query();
			for (const { id, files } of remoteSkills) {
				let skill: zSkill | null = null;
				try {
					skill = SkillUtils.buildSkill({
						files: files.map((file) => ({ path: file.uri, data: file.data })),
					});
				} catch (error) {
					console.warn("failed to build native skill:", error);
				}
				skills.push(
					skill ?? {
						path: PathUtils.toMount({ mount: "skills", id }),
						name: "",
						description: "Error: unrecognized format",
						attributes: {},
					},
				);
			}

			console.log("[useSkills] built native skills:", skills);
			return skills;
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const deleteNativeSkill = useMutation({
		...client.query.upload.deleteUpload.mutationOptions(),
		onSuccess: () => {
			void nativeSkills.refetch();
		},
	});

	const skills = useMemo(() => {
		return [...(localSkills.data ?? []), ...(nativeSkills.data ?? [])];
	}, [localSkills.data, nativeSkills.data]);

	return { localSkills, nativeSkills, deleteNativeSkill, skills };
};
