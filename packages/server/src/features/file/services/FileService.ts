import { dirname } from "node:path";
import { Bash, InMemoryFs, MountableFs } from "just-bash";
import type { zUser } from "#core/features/data/types/user.ts";
import type {
	FileNode,
	FileState,
	FilesystemSpec,
} from "#core/features/file/types/file.ts";
import {
	type PathLike,
	PathUtils,
} from "#core/features/file/utils/PathUtils.ts";
import { ChatService } from "#server/features/chat/services/ChatService.ts";
import { FilesystemService } from "#server/features/file/services/FilesystemService.ts";

type Instance = {
	bash: Bash;
	filesystem: FilesystemService;
	mounts: MountableFs;
};
type Session = {
	instance?: Instance;
	cwd: string;
	/** The chat's folders that resolve on the mount, the one it starts in first. */
	folders: string[];
	env?: Record<string, string>;
	reset: boolean;
	touched: number;
	pending: number;
	queue: Promise<unknown>;
};
const sessions = new Map<string, Session>();
const sessionKey = (user: string, chat: string) => JSON.stringify([user, chat]);
const cleanup = setInterval(() => {
	for (const [key, session] of sessions) {
		if (!session.pending && Date.now() - session.touched > 30 * 60_000)
			sessions.delete(key);
	}
}, 60_000);
cleanup.unref();

export const FileService = {
	cwd: async (options: { user: zUser } & FilesystemSpec): Promise<string> => {
		const result = await FileService.exec({ ...options, command: "pwd" });
		if (!result.stdout)
			throw new Error(result.stderr || "Cannot read chat working directory");
		return result.stdout.replace(/\n$/, "");
	},
	folders: async ({
		user,
		...spec
	}: { user: zUser } & FilesystemSpec): Promise<string[]> => {
		if (!spec.chat) return [];
		// Settles the session first, which is when its folders are resolved.
		await FileService.exec({ user, ...spec, command: "pwd" });
		return sessions.get(sessionKey(user.id, spec.chat))?.folders ?? [];
	},
	activate: (user: string, chat: string) => {
		const session = sessions.get(sessionKey(user, chat));
		if (session) session.reset = true;
	},
	get: async ({
		user,
		...spec
	}: { user: zUser } & FilesystemSpec): Promise<Instance> => {
		const filesystem = new FilesystemService({ user, ...spec });
		await filesystem.fetch();

		const mounts = new MountableFs({
			base: new InMemoryFs(),
			mounts: [
				{
					mountPoint: `${PathUtils.mount}/`,
					filesystem: filesystem.clone("/"),
				},
			],
		});
		const bash = new Bash({
			fs: mounts,
			defenseInDepth: { enabled: true, auditMode: true },
			python: true,
			cwd: PathUtils.mount,
		});

		return { bash, filesystem, mounts };
	},

	/**
	 * Get a file, with data, on the mount.
	 */
	getFile: async ({
		user,
		path,
		...spec
	}: { user: zUser; path: PathLike } & FilesystemSpec): Promise<FileState> => {
		const { filesystem } = await FileService.get({ user, ...spec });
		const uri = PathUtils.asMount(path) ?? "";
		return { ...(await filesystem.getFile(uri)), uri };
	},

	/**
	 * Get every file on the mount.
	 */
	getFiles: async ({
		user,
		...spec
	}: { user: zUser } & FilesystemSpec): Promise<FileNode[]> => {
		const { filesystem } = await FileService.get({ user, ...spec });
		return filesystem.getAllNodes();
	},

	getDirectory: async ({
		user,
		path,
		...spec
	}: { user: zUser; path: PathLike } & FilesystemSpec) => {
		const { filesystem } = await FileService.get({ user, ...spec });
		return await filesystem.readdirWithFileTypes(
			PathUtils.asMount(path) ?? PathUtils.mount,
		);
	},

	writeFile: async ({
		user,
		path,
		content,
		...spec
	}: { user: zUser; path: PathLike; content: string } & FilesystemSpec) => {
		const { filesystem } = await FileService.get({ user, ...spec });
		const uri = PathUtils.asMount(path);
		if (!uri) throw new Error(`invalid path: ${path}`);
		await filesystem.mkdir(dirname(uri), { recursive: true });
		return await filesystem.writeFile(uri, content);
	},

	rename: async ({
		user,
		path,
		to,
		...spec
	}: { user: zUser; path: PathLike; to: PathLike } & FilesystemSpec) => {
		const { filesystem } = await FileService.get({ user, ...spec });
		const from = PathUtils.asMount(path);
		const uri = PathUtils.asMount(to);
		if (!from) throw new Error(`invalid path: ${path}`);
		if (!uri) throw new Error(`invalid path: ${to}`);
		await filesystem.mkdir(dirname(uri), { recursive: true });
		await filesystem.mv(from, uri);
		return uri;
	},

	remove: async ({
		user,
		path,
		...spec
	}: { user: zUser; path: PathLike } & FilesystemSpec) => {
		const { filesystem } = await FileService.get({ user, ...spec });
		const uri = PathUtils.asMount(path);
		if (!uri) throw new Error(`invalid path: ${path}`);
		await filesystem.rm(uri, { recursive: true });
		return uri;
	},

	exec: async ({
		user,
		command,
		abort,
		...spec
	}: {
		user: zUser;
		command: string;
		abort?: AbortSignal;
	} & FilesystemSpec) => {
		if (!spec.chat) {
			const { bash } = await FileService.get({ user, ...spec });
			const result = await bash.exec(command, { signal: abort });
			return { ...result, code: result.exitCode };
		}
		const key = sessionKey(user.id, spec.chat);
		let session = sessions.get(key);
		if (!session) {
			session = {
				cwd: PathUtils.mount,
				folders: [],
				reset: true,
				touched: Date.now(),
				pending: 0,
				queue: Promise.resolve(),
			};
			sessions.set(key, session);
		}
		const current = session;
		current.pending++;
		const run = current.queue
			.then(async () => {
				abort?.throwIfAborted();
				// Recheck ownership even when a shell already exists (including deleted chats).
				const folder = await ChatService.getWorkingDirectory({
					user,
					chat: spec.chat,
				});
				// Folders inside a shared tree mount it, so it can be worked in.
				const mounted = (kind: string) =>
					folder.folders.flatMap(({ path }) => {
						const [, root, mount, id] = path.split("/");
						return `/${root}` === PathUtils.mount && mount === kind && id
							? [id]
							: [];
					});
				const mounts = {
					...spec,
					uploads: [
						...new Set([...(spec.uploads ?? []), ...mounted("uploads")]),
					],
					skills: [...new Set([...(spec.skills ?? []), ...mounted("skills")])],
				};
				const filesystem = new FilesystemService({ user, ...mounts });
				await filesystem.fetch();
				if (!current.instance)
					current.instance = await FileService.get({ user, ...mounts });
				else {
					current.instance.mounts.unmount(PathUtils.mount);
					current.instance.mounts.mount(PathUtils.mount, filesystem.clone("/"));
				}
				const { bash } = current.instance;
				if (current.reset) {
					current.reset = false;
					// Folders sync across devices; only those on the mount resolve here.
					const resolved: string[] = [];
					for (const path of folder.candidates) {
						if (
							path !== PathUtils.mount &&
							!path.startsWith(`${PathUtils.mount}/`)
						)
							continue;
						try {
							if ((await filesystem.stat(path)).isDirectory)
								resolved.push(path);
						} catch {
							/* Missing folders are left out. */
						}
					}
					current.folders = resolved;
					current.cwd = resolved[0] ?? PathUtils.mount;
				}
				try {
					const result = await bash.exec(command, {
						signal: abort,
						cwd: current.cwd,
						env: current.env ? { ...current.env, PWD: current.cwd } : undefined,
					});
					current.env = result.env;
					if (result.env.PWD) current.cwd = result.env.PWD;
					return { ...result, code: result.exitCode };
				} catch (error) {
					// A filesystem error the shell could not turn into output of its own —
					// a redirect into a read-only tree, most often, since it writes the
					// target before it has anywhere to put the error — is still the
					// command failing rather than the call failing. Report it the way the
					// shell would have.
					console.warn(
						"[FileService] command failed outside the shell:",
						error,
					);
					return {
						code: 1,
						stdout: "",
						stderr: `${error instanceof Error ? error.message : String(error)}\n`,
					};
				}
			})
			.finally(() => {
				current.pending--;
				current.touched = Date.now();
			});
		current.queue = run.catch(() => {});
		return run;
	},
} as const;
