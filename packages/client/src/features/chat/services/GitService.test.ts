import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitService } from "#client/features/chat/services/GitService.ts";
import type { ShellCapability } from "#core/core/types/capability.ts";

// The machine's own shell, as the CLI and desktop hand it over.
const shell: ShellCapability = {
	readFile: async ({ path }) => ({ path, data: readFileSync(path) }),
	readDir: async () => [],
	writeFile: async ({ path }) => ({ path, success: true }),
	rename: async ({ to }) => ({ path: to, success: true }),
	remove: async ({ path }) => ({ path, success: true }),
	exec: async () => {
		throw new Error("Expected a direct process call");
	},
	run: async ({ program, args }) => {
		const result = spawnSync(program, args, { encoding: "utf8" });
		if (result.error) throw result.error;
		return {
			code: result.status ?? undefined,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	},
};

describe("GitService", () => {
	let root: string;
	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "git-service-")).replace(/\\/g, "/");
		const git = (args: string) =>
			execFileSync(
				"git",
				[
					"-c",
					"user.name=t",
					"-c",
					"user.email=t@t",
					"-c",
					"core.autocrlf=false",
					...args.split(" "),
				],
				{ cwd: root },
			);
		git("init -q");
		mkdirSync(join(root, "src/deep"), { recursive: true });
		writeFileSync(join(root, "src/a.ts"), "one\ntwo\nthree\n");
		writeFileSync(join(root, "gone.txt"), "x\ny\n");
		git("add -A");
		git("commit -qm init");
		writeFileSync(join(root, "src/a.ts"), "one\n2\nthree\nfour\n");
		rmSync(join(root, "gone.txt"));
		writeFileSync(join(root, "src/deep/new file.ts"), "a\nb\nc");
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("finds the repository from anywhere inside it, once", async () => {
		const found = await GitService.roots({
			shell,
			directories: [join(root, "src/deep"), join(root, "src"), tmpdir()],
		});
		expect(found).toEqual([root]);
	});

	it("reports tracked and untracked changes", async () => {
		const repo = await GitService.status({ shell, root });
		expect(repo.head).toBe(true);
		const byPath = Object.fromEntries(
			repo.changes.map((change) => [change.path, change]),
		);
		expect(byPath[`${root}/src/a.ts`]).toMatchObject({
			additions: 2,
			deletions: 1,
			untracked: false,
		});
		expect(byPath[`${root}/gone.txt`]).toMatchObject({
			additions: 0,
			deletions: 2,
		});
		expect(byPath[`${root}/src/deep/new file.ts`]).toMatchObject({
			additions: 3,
			untracked: true,
		});
	});

	it("reads untracked files in one call where the shell can", async () => {
		const big = join(root, "big.txt");
		writeFileSync(big, "line\n".repeat(300_000));
		const calls: string[][] = [];
		const bulk: ShellCapability = {
			...shell,
			readFile: () => Promise.reject(new Error("read one at a time")),
			readFiles: async ({ paths, maxBytes }) => {
				calls.push(paths);
				return paths.map((path) => {
					const data = readFileSync(path);
					return { data: data.subarray(0, maxBytes), size: data.length };
				});
			},
		};
		try {
			const repo = await GitService.status({ shell: bulk, root });
			expect(calls).toHaveLength(1);
			const byPath = Object.fromEntries(
				repo.changes.map((change) => [change.path, change]),
			);
			expect(byPath[`${root}/src/deep/new file.ts`]).toMatchObject({
				additions: 3,
				untracked: true,
			});
			// Too large to read whole, so not counted.
			expect(byPath[`${root}/big.txt`]).toMatchObject({
				additions: 0,
				binary: false,
			});
		} finally {
			rmSync(big);
		}
	});

	it("reads a file as it was at the last commit", async () => {
		const repo = await GitService.status({ shell, root });
		const change = repo.changes.find((change) => change.path.endsWith("a.ts"));
		const untracked = repo.changes.find((change) => change.untracked);
		if (!change || !untracked) throw new Error("missing changes");
		expect(await GitService.original({ shell, repo, change })).toBe(
			"one\ntwo\nthree\n",
		);
		expect(await GitService.original({ shell, repo, change: untracked })).toBe(
			"",
		);
	});
});
