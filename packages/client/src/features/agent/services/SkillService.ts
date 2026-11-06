import type { ShellCapability } from "#core/core/types/capability.ts";
import { FileOperationService } from "#core/features/file/services/FileOperationService.ts";
import { FileSearchService } from "#core/features/file/services/FileSearchService.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import { SkillUtils } from "#core/features/skill/utils/SkillUtils.ts";

const SKILL_DIRECTORIES = [".agents/skills", ".codex/skills", ".claude/skills"];
const MAX_SKILL_MD_BYTES = 256_000;

export const SkillService = {
	discover: async ({
		shell,
		primaryFolder,
	}: {
		shell: ShellCapability;
		primaryFolder?: string | null;
	}): Promise<zSkill[]> => {
		const roots = ["~", ...(primaryFolder ? [primaryFolder] : [])].flatMap(
			(base) =>
				SKILL_DIRECTORIES.map(
					(directory) => `${base.replace(/[\\/]+$/, "")}/${directory}`,
				),
		);
		const listings = await Promise.all(
			[...new Set(roots)].map(async (path) => {
				try {
					return await FileSearchService.walk({
						shell,
						path,
						scope: "listing",
						gitignore: false,
					});
				} catch {
					// Missing or inaccessible roots do not hide the other roots.
					return null;
				}
			}),
		);
		// Nested collections (such as Codex's .system) can contain several skills.
		// Keep identity by path: two skills with the same name remain selectable.
		const paths = [
			...new Set(
				listings.flatMap(
					(listing) =>
						listing?.entries.flatMap((entry) =>
							!entry.is_dir &&
							PathUtils.name(entry.path).toLowerCase() === "skill.md"
								? [entry.path]
								: [],
						) ?? [],
				),
			),
		];
		const files = await FileOperationService.readFiles({
			shell,
			paths,
			maxBytes: MAX_SKILL_MD_BYTES,
		});
		return paths.map((path, index) => {
			try {
				const file = files[index];
				const skill =
					file && SkillUtils.buildSkill({ files: [{ path, data: file.data }] });
				if (skill) return skill;
			} catch (error) {
				console.warn("failed to build local skill:", error);
			}
			return {
				path,
				name: "",
				description: "Error: unrecognized format",
				attributes: {},
			};
		});
	},
} as const;
