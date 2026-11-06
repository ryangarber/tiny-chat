import type { ShellProcess } from "#client/features/shell/utils/ShellLaunchUtils.ts";
import {
	type ShellLauncher,
	ShellLaunchUtils,
	WINDOWS_SHELLS,
} from "#client/features/shell/utils/ShellLaunchUtils.ts";
import type {
	ShellCapability,
	ShellEnvironment,
} from "#core/core/types/capability.ts";

type Exec = ShellCapability["exec"];

/**
 * What a runtime gives the client to build its shell from. It never changes
 * its own process's directory or picks a shell: `cwd` is only where it
 * started, and every process is told what to run and where.
 */
export type HostShellPrimitives = Pick<
	ShellCapability,
	| "tmpdir"
	| "readFile"
	| "readFiles"
	| "readDir"
	| "walk"
	| "writeFile"
	| "rename"
	| "remove"
> & {
	os: ShellEnvironment["os"];

	/** The directory the runtime started in. */
	cwd: () => Promise<string>;

	/** The absolute, canonical form of a directory; throws if it is not one. */
	resolveDir: (_: { path: string }) => Promise<string>;

	/** The first of `paths` that is a file, made absolute; null if none is. */
	locate: (_: { paths: readonly string[] }) => Promise<string | null>;

	spawn: (
		_: ShellProcess & Omit<Parameters<Exec>[0], "command">,
	) => ReturnType<Exec>;
};

const ABSOLUTE_REGEX = /^(?:[\\/]|[A-Za-z]:[\\/]|~)/;

/** `path` against `cwd`, joined with whichever separator `cwd` uses. */
const resolve = (cwd: string, path: string) => {
	if (ABSOLUTE_REGEX.test(path)) return path;
	const separator = cwd.includes("/") || !cwd.includes("\\") ? "/" : "\\";
	return `${cwd.replace(/[\\/]+$/, "")}${separator}${path}`;
};

type State = { cwd: string; launcher: ShellLauncher };

export const HostShellService = {
	/**
	 * The user's shell over a runtime's primitives.
	 *
	 * Its working directory is its own rather than the process's, so relative
	 * paths and commands go where it was pointed without anything else in the
	 * process moving. Which shell runs a command follows from that directory:
	 * one inside a WSL distro runs in the distro, and anything else in the
	 * platform's own shell. Paths go in and come out as that shell spells them,
	 * so what the model reads in a listing is what it can pass back.
	 */
	create: (primitives: HostShellPrimitives): ShellCapability => {
		const native: Promise<ShellLauncher> =
			primitives.os === "windows"
				? Promise.all([
						primitives.locate({ paths: WINDOWS_SHELLS.gitBash }),
						primitives.locate({ paths: WINDOWS_SHELLS.pwsh }),
					]).then(([gitBash, pwsh]) =>
						ShellLaunchUtils.native({ os: "windows", gitBash, pwsh }),
					)
				: Promise.resolve(ShellLaunchUtils.native({ os: primitives.os }));

		const enter = async (cwd: string): Promise<State> => ({
			cwd,
			launcher: ShellLaunchUtils.forDirectory({
				path: cwd,
				native: await native,
			}),
		});

		// Read synchronously by `environment` and `toShellPath`; kept in step
		// with `state` once each move settles.
		let launcher = ShellLaunchUtils.native({ os: primitives.os });
		let state = primitives.cwd().then(enter);
		const settle = (next: Promise<State>) => {
			state = next;
			void next.then((value) => {
				if (state === next) launcher = value.launcher;
			});
			return next;
		};
		settle(state);

		/** A path the model or the user gave, as the host spells it. */
		const at = async (path: string) => {
			const { cwd, launcher } = await state;
			return launcher.toHost(resolve(launcher.toShell(cwd), path));
		};

		const out = async <T extends { path: string }>(item: T) => ({
			...item,
			path: (await state).launcher.toShell(item.path),
		});

		const { readFiles, walk, tmpdir } = primitives;

		return {
			tmpdir:
				tmpdir && (async () => (await state).launcher.toShell(await tmpdir())),
			cwd: async () => {
				const { cwd, launcher } = await state;
				return launcher.toShell(cwd);
			},
			chdir: async ({ path }) => {
				const { cwd, launcher } = await state;
				const resolved = resolve(launcher.toShell(cwd), path);
				// Read as the current shell spells paths, then as the platform's
				// own does: moving back out of WSL names a directory its way.
				const candidates = [
					...new Set([
						launcher.toHost(resolved),
						(await native).toHost(resolved),
					]),
				];
				let error: unknown;
				for (const candidate of candidates) {
					try {
						const directory = await primitives.resolveDir({
							path: candidate,
						});
						await settle(enter(directory));
						return;
					} catch (caught) {
						error ??= caught;
					}
				}
				throw error;
			},
			environment: () => launcher.environment,
			toShellPath: ({ path }) => launcher.toShell(path),
			readFile: async ({ path }) =>
				await out(await primitives.readFile({ path: await at(path) })),
			readFiles:
				readFiles &&
				(async ({ paths, maxBytes }) =>
					await readFiles({
						paths: await Promise.all(paths.map(at)),
						maxBytes,
					})),
			readDir: async ({ path }) =>
				await Promise.all(
					(await primitives.readDir({ path: await at(path) })).map(out),
				),
			walk:
				walk &&
				(async ({ path, ...options }) => {
					const result = await walk({
						path: await at(path),
						...options,
					});
					const { launcher } = await state;
					return {
						...result,
						root: launcher.toShell(result.root),
						entries: result.entries.map((entry) => ({
							...entry,
							path: launcher.toShell(entry.path),
						})),
					};
				}),
			writeFile: async ({ path, content }) =>
				await out(
					await primitives.writeFile({ path: await at(path), content }),
				),
			rename: async ({ path, to }) =>
				await out(
					await primitives.rename({ path: await at(path), to: await at(to) }),
				),
			remove: async ({ path }) =>
				await out(await primitives.remove({ path: await at(path) })),
			exec: async ({ command, stream, abort }) => {
				const { cwd, launcher } = await state;
				return await primitives.spawn({
					...launcher.exec({ command, cwd }),
					stream,
					abort,
				});
			},
			run: async ({ program, args, abort }) => {
				const { cwd, launcher } = await state;
				return await primitives.spawn({
					...launcher.run({ program, args, cwd }),
					abort,
				});
			},
		};
	},
} as const;
