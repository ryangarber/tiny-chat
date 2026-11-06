import type { Capabilities } from "#core/core/types/capability.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { FileOperationService } from "#core/features/file/services/FileOperationService.ts";
import { FileEditUtils } from "#core/features/file/utils/FileEditUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import type {
	zFileStep,
	zFileStepResult,
} from "#core/features/tool/types/files.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";

type Shells = Pick<Capabilities, "shell" | "chatShell">;

const key = (path: string) =>
	PathUtils.normalize({ path, unix: true }).replace(/\/+$/, "");

const label = (step: zFileStep, index: number) =>
	`Step ${index + 1} (${step.action} ${step.path})`;

/**
 * Bulk file changes, run in order the way the `browser` and `computer` tools
 * run their steps: `write`, `edit`, `rename` and `delete`, each against the
 * filesystem its path is on.
 */
export const FileEditService = {
	/**
	 * Plays the steps against the files as each would leave them, without
	 * changing anything, so a batch that could never land fails before any of
	 * it is applied or approved. A step after renaming a directory is left to
	 * fail when it runs, as there is nothing to play it against.
	 */
	check: async ({
		steps,
		capabilities,
	}: {
		steps: zFileStep[];
		capabilities: Shells;
	}) => {
		// What each path holds after the steps so far; null once it is gone.
		const overlay = new Map<string, string | null>();

		const read = async (path: string) => {
			const cached = overlay.get(key(path));
			if (cached === null)
				throw new Error("No such file: an earlier step removed it.");
			if (cached !== undefined) return cached;
			const file = await ShellUtils.detect(path, capabilities).readFile({
				path,
			});
			const content = FileUtils.getTextFromBytes(file);
			if (content === null) throw new Error("Cannot read file as text.");
			return content;
		};

		for (const [index, step] of steps.entries()) {
			try {
				ShellUtils.detect(step.path, capabilities);
				if (step.action === "write") {
					overlay.set(key(step.path), step.content);
				} else if (step.action === "edit") {
					const { content } = FileEditUtils.apply({
						content: await read(step.path),
						old_string: step.old_string,
						new_string: step.new_string,
						replace_all: step.replace_all,
					});
					overlay.set(key(step.path), content);
				} else if (step.action === "rename") {
					FileEditService.checkRename(step);
					let content: string;
					try {
						content = await read(step.path);
					} catch {
						// A directory, or missing: found out when it runs.
						return;
					}
					overlay.set(key(step.to), content);
					overlay.set(key(step.path), null);
				} else {
					overlay.set(key(step.path), null);
				}
			} catch (error) {
				throw new Error(
					`${label(step, index)} failed, so no steps were applied: ${CommonUtils.formatError({ error })}`,
				);
			}
		}
	},

	checkRename: ({ path, to }: { path: string; to: string }) => {
		if (PathUtils.isMounted(path) !== PathUtils.isMounted(to))
			throw new Error(
				`Cannot move between ${PathUtils.mount} and the user's filesystem. Write the file at its new path and delete the old one instead.`,
			);
		if (key(path) === key(to))
			throw new Error("The new path is the same as the old one.");
	},

	/**
	 * Runs the steps in order, stopping at the first that fails. What ran is
	 * reported either way, so the model knows what is already applied.
	 */
	run: async ({
		steps,
		capabilities,
		abort,
	}: {
		steps: zFileStep[];
		capabilities: Shells;
		abort?: AbortSignal;
	}): Promise<{ steps: zFileStepResult[]; skipped?: number }> => {
		const results: zFileStepResult[] = [];

		for (const [index, step] of steps.entries()) {
			abort?.throwIfAborted();
			try {
				results.push(await FileEditService.runStep({ step, capabilities }));
			} catch (error) {
				results.push({
					action: step.action,
					path: step.path,
					...(step.action === "rename" ? { to: step.to } : {}),
					error: CommonUtils.formatError({ error }),
				});
				const skipped = steps.length - index - 1;
				return { steps: results, ...(skipped ? { skipped } : {}) };
			}
		}

		return { steps: results };
	},

	runStep: async ({
		step,
		capabilities,
	}: {
		step: zFileStep;
		capabilities: Shells;
	}): Promise<zFileStepResult> => {
		const shell = ShellUtils.detect(step.path, capabilities);

		if (step.action === "write") {
			const written = await shell.writeFile({
				path: step.path,
				content: step.content,
			});
			return { action: step.action, path: written.path };
		}

		if (step.action === "edit") {
			const edited = await FileOperationService.editFile({
				shell,
				path: step.path,
				old_string: step.old_string,
				new_string: step.new_string,
				replace_all: step.replace_all,
			});
			return {
				action: step.action,
				path: edited.path,
				replacements: edited.replacements,
				preview: edited.preview,
			};
		}

		if (step.action === "rename") {
			FileEditService.checkRename(step);
			const moved = await shell.rename({ path: step.path, to: step.to });
			return { action: step.action, path: step.path, to: moved.path };
		}

		const removed = await shell.remove({ path: step.path });
		return { action: step.action, path: removed.path };
	},
} as const;
