import type { ShellCapability } from "#core/core/types/capability.ts";
import {
	type Worktree,
	WorktreeUtils,
} from "#core/features/file/utils/WorktreeUtils.ts";

/** A path as one bash word, for a shell that can only take a command line. */
const quote = (word: string) => `"${word.replace(/(["$`\\])/g, "\\$1")}"`;

export const WorktreeService = {
	/**
	 * The git worktree `directory` is in, with the main checkout it belongs to;
	 * null if it is in none, or git is not there to ask.
	 */
	get: async ({
		shell,
		directory,
	}: {
		shell: ShellCapability;
		directory: string;
	}): Promise<Worktree | null> => {
		const args = ["-C", directory, ...WorktreeUtils.args];
		try {
			const result = shell.run
				? await shell.run({ program: "git", args })
				: await shell.exec({
						command: ["git", ...args].map(quote).join(" "),
					});
			return result.code === 0 ? WorktreeUtils.parse(result.stdout) : null;
		} catch {
			return null;
		}
	},
} as const;
