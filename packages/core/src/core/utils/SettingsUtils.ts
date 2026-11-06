import { ThemeUtils } from "#core/core/utils/ThemeUtils.ts";
import { TypeUtils } from "#core/core/utils/TypeUtils.ts";
import { zSettings } from "#core/features/data/types/user.ts";

type zSettingsWithDefaults = Required<zSettings>;

export const SettingsUtils = {
	of: (
		user?: { settings?: zSettings | null } | null,
		context?: { settings?: zSettings | null } | null,
	): zSettingsWithDefaults => {
		return SettingsUtils.defaults(
			SettingsUtils.merge({
				to: user?.settings ?? {},
				from: context?.settings ?? null,
			}),
		);
	},

	/**
	 * Where the shell may start, best first: the project's folders, then the
	 * user's. Folders sync across devices, so each runtime starts in the first
	 * that resolves on it.
	 */
	primaryCandidates: (
		user?: { settings?: zSettings | null } | null,
		project?: { settings?: zSettings | null } | null,
	): string[] => [
		...new Set(
			[
				...(project?.settings?.folders ?? []),
				...(user?.settings?.folders ?? []),
			].map(({ path }) => path),
		),
	],

	/** Whether `path` is `folder` or sits under it, both spelled the same way. */
	contains: ({ folder, path }: { folder: string; path: string }) => {
		const trim = (value: string) => value.replace(/(?<=.)[\\/]+$/, "");
		const [outer, inner] = [trim(folder), trim(path)];
		return (
			inner === outer ||
			inner.startsWith(`${outer}/`) ||
			inner.startsWith(`${outer}\\`) ||
			((outer.endsWith("/") || outer.endsWith("\\")) && inner.startsWith(outer))
		);
	},

	/**
	 * `paths` with the one holding `cwd` most closely moved to the front: a
	 * runtime launched inside a folder starts there. `toShellPath` spells a
	 * folder the way `cwd` is spelled.
	 */
	preferContaining: ({
		paths,
		cwd,
		toShellPath = (path) => path,
	}: {
		paths: string[];
		cwd?: string | null;
		toShellPath?: (path: string) => string;
	}): string[] => {
		if (!cwd) return paths;
		const match = paths
			.filter((path) =>
				SettingsUtils.contains({ folder: toShellPath(path), path: cwd }),
			)
			.sort((a, b) => toShellPath(b).length - toShellPath(a).length)[0];
		return match ? [match, ...paths.filter((path) => path !== match)] : paths;
	},

	/**
	 * Merges settings with the context's entries last.
	 */
	merge: ({
		to,
		from,
	}: {
		to: zSettings;
		from?: zSettings | null;
	}): zSettings => {
		const merged = TypeUtils.deepClone(to);
		if (from) {
			const overrides = TypeUtils.deepClone(from);
			for (const key of zSettings.keyof().options) {
				if (overrides[key] === undefined) continue;
				if (Array.isArray(merged[key]) && Array.isArray(overrides[key])) {
					Object.assign(merged, { [key]: [...merged[key], ...overrides[key]] });
				} else if (
					merged[key] !== null &&
					typeof merged[key] === "object" &&
					typeof overrides[key] === "object"
				) {
					Object.assign(merged[key], overrides[key]);
				} else {
					Object.assign(merged, { [key]: overrides[key] });
				}
			}
		}
		return merged;
	},

	defaults: (from?: zSettings | null): zSettingsWithDefaults => {
		const codeThemes = [
			...ThemeUtils.codeThemesByTheme[from?.theme ?? ThemeUtils.themes[0]],
		];
		return {
			...from,
			theme: from?.theme ?? ThemeUtils.themes[0],
			codeTheme:
				from?.codeTheme && codeThemes.includes(from.codeTheme)
					? from.codeTheme
					: codeThemes[0],
			// Drawing large images (screenshots, mostly) stalls the terminal UI.
			tuiImages: from?.tuiImages ?? "none",
			instructions: from?.instructions ?? [],
			commands: from?.commands ?? [],
			folders: from?.folders ?? [],
			memoryBudget: from?.memoryBudget ?? 2500,
			embeddingConfig: from?.embeddingConfig ?? null,
			dreamConfig: from?.dreamConfig ?? null,
			presets: from?.presets ?? {},
			providers: from?.providers ?? {},
			preferredWebProvider: from?.preferredWebProvider ?? null,
			mcpServers: from?.mcpServers ?? {},
			hiddenModels: {
				language: from?.hiddenModels?.language ?? [],
				embedding: from?.hiddenModels?.embedding,
			},
			subagentConfig: from?.subagentConfig ?? null,
			useBrowserModels: from?.useBrowserModels ?? false,
			useEmbeddingSearch: from?.useEmbeddingSearch ?? false,
			useProviderCache: from?.useProviderCache ?? false,
		};
	},
} as const;
