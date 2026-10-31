import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

/** A linked git worktree, and the main checkout it was added from. */
export interface Worktree {
	/** The worktree's own root. */
	worktree: string;
	/** The main checkout's root, where the repository itself lives. */
	main: string;
}

const unix = (path: string) =>
	PathUtils.normalize({ path: path.trim(), unix: true }).replace(
		/(?<=.)\/+$/,
		"",
	);

export const WorktreeUtils = {
	/** `git` arguments whose output {@link WorktreeUtils.parse} reads. */
	args: [
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
		"--show-toplevel",
	],

	/**
	 * The worktree a directory is in, from the output of `git` run there with
	 * {@link WorktreeUtils.args}. Null for a main checkout, and for a bare
	 * repository or a submodule, which have no main checkout to point at.
	 */
	parse: (output: string): Worktree | null => {
		const [common, top] = output.trim().split(/\r?\n/).map(unix);
		if (!common || !top || !common.endsWith("/.git")) return null;
		const main = common.slice(0, -"/.git".length) || "/";
		return main === top ? null : { worktree: top, main };
	},

	/**
	 * Where `path`, inside a worktree, sits in its main checkout: the same
	 * place relative to each root. Null if `path` is not in the worktree.
	 */
	toMain: ({ path, worktree, main }: Worktree & { path: string }) => {
		const inner = unix(path);
		if (inner !== worktree && !inner.startsWith(`${worktree}/`)) return null;
		return `${main === "/" ? "" : main}${inner.slice(worktree.length)}` || "/";
	},
} as const;
