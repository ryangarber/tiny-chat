import type { ShellCapability } from "#core/core/types/capability.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";

const normalizeAbsolutePath = (path: string): string | null => {
	const normalized = PathUtils.normalize({ path, unix: true });
	const drive = /^[A-Za-z]:\//.exec(normalized)?.[0];
	const root = drive ?? (normalized.startsWith("/") ? "/" : null);
	if (!root) return null;

	const parts: string[] = [];
	for (const part of normalized.slice(root.length).split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (!parts.length) return null;
			parts.pop();
			continue;
		}
		parts.push(part);
	}

	return `${root}${parts.join("/")}`.replace(/\/$/, "") || "/";
};

const contains = (folderPath: string, path: string): boolean => {
	const folder = normalizeAbsolutePath(folderPath);
	const target = normalizeAbsolutePath(path);
	if (!folder || !target) return false;

	const windows = /^[A-Za-z]:/.test(folder) && /^[A-Za-z]:/.test(target);
	const comparableFolder = windows ? folder.toLowerCase() : folder;
	const comparableTarget = windows ? target.toLowerCase() : target;
	if (comparableTarget === comparableFolder) return true;
	if (comparableFolder === "/") return true;

	return comparableTarget.startsWith(`${comparableFolder}/`);
};

export const FileToolUtils = {
	/**
	 * Writes skip approval inside `/mnt/chat` (the chat's own scratch tree), or
	 * inside the OS temporary directory, or a writable folder from the merged
	 * settings (last matching folder wins).
	 * Folders are compared as the local `shell` spells paths, which is how the
	 * model names them.
	 */
	requiresApproval: ({
		path,
		context,
		shell,
		tmpdir,
		cwd,
	}: {
		path: string;
		context: zAgentContext;
		shell?: ShellCapability;
		tmpdir?: string;
		cwd?: string;
	}): boolean => {
		const localPath = shell?.toShellPath?.({ path }) ?? path;
		const normalized =
			normalizeAbsolutePath(localPath) ??
			(cwd && !/^(?:[\\/]|[A-Za-z]:)/.test(localPath)
				? normalizeAbsolutePath(`${cwd}/${localPath}`)
				: null);
		if (
			normalized &&
			PathUtils.fromMount({ path: normalized })?.mount === "chat"
		)
			return false;

		if (tmpdir && contains(tmpdir, normalized ?? localPath)) return false;

		const { folders } = SettingsUtils.of(context.user, context.chat?.project);
		const local = shell ? ShellUtils.toShellFolders(shell, folders) : folders;
		return !local.findLast((folder) =>
			contains(folder.path, normalized ?? localPath),
		)?.whitelist;
	},
} as const;
