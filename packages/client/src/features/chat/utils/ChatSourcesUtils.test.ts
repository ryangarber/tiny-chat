import type { GitRepo } from "#client/features/chat/types/chatFiles.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";

const repo: GitRepo = {
	root: "/work/repo",
	head: true,
	changes: [
		{
			path: "/work/repo/src/a.ts",
			additions: 3,
			deletions: 1,
			untracked: false,
			binary: false,
		},
		{
			path: "/work/repo/src/deep/b.ts",
			additions: 2,
			deletions: 0,
			untracked: true,
			binary: false,
		},
		{
			path: "/work/repo/README.md",
			additions: 0,
			deletions: 4,
			untracked: false,
			binary: false,
		},
	],
};

describe("ChatSourcesUtils", () => {
	it("adds up changes below a folder, not beside it", () => {
		expect(
			ChatSourcesUtils.changes({ path: "/work/repo/src", repos: [repo] }),
		).toEqual({
			additions: 5,
			deletions: 1,
		});
		expect(
			ChatSourcesUtils.changes({ path: "/work/repo", repos: [repo] }),
		).toEqual({
			additions: 5,
			deletions: 5,
		});
		expect(
			ChatSourcesUtils.changes({ path: "/work/repo/sr", repos: [repo] }),
		).toBeUndefined();
	});

	it("builds a tree with folders filled in and totals on every local node", () => {
		const tree = ChatSourcesUtils.tree({
			files: [
				ChatSourcesUtils.local("/work/repo/src", true),
				ChatSourcesUtils.local("/work/repo/src/a.ts", false),
				{
					path: "/mnt/chat/x/notes.md",
					directory: false,
					local: false,
					displayPath: ["chat", "notes.md"],
				},
			],
			repos: [repo],
		});
		const [local, mount] = tree;
		expect(local.value).toBe("local:local");
		expect(local.changes).toBeUndefined();
		expect(mount.value).toBe("mount:chat");
		expect(mount.children[0].file?.path).toBe("/mnt/chat/x/notes.md");

		const repoNode = local.children[0].children[0];
		expect(repoNode.label).toBe("repo");
		expect(repoNode.file).toBeUndefined();
		expect(repoNode.changes).toEqual({ additions: 5, deletions: 5 });

		const src = repoNode.children[0];
		expect(src.file?.path).toBe("/work/repo/src");
		expect(src.directory).toBe(true);
		expect(src.changes).toEqual({ additions: 5, deletions: 1 });

		const file = src.children[0];
		expect(file.directory).toBe(false);
		expect(file.changes).toEqual({ additions: 3, deletions: 1 });
	});

	it("names a file's node and its parents the way the tree does", () => {
		const file = ChatSourcesUtils.local("/work/repo/src/a.ts", false);
		expect(ChatSourcesUtils.node(file)).toEqual({
			value: "local:local/work/repo/src/a.ts",
			parents: [
				"local:local",
				"local:local/work",
				"local:local/work/repo",
				"local:local/work/repo/src",
			],
		});
	});

	it("flattens only what is expanded", () => {
		const tree = ChatSourcesUtils.tree({
			files: [ChatSourcesUtils.local("/a/b.ts", false)],
		});
		expect(
			ChatSourcesUtils.flatten({ nodes: tree, expanded: () => false }).map(
				(row) => row.node.label,
			),
		).toEqual(["local"]);
		expect(
			ChatSourcesUtils.flatten({ nodes: tree, expanded: () => true }).map(
				(row) => [row.node.label, row.depth],
			),
		).toEqual([
			["local", 0],
			["a", 1],
			["b.ts", 2],
		]);
	});

	it("keeps the longest read of each web page", () => {
		const page = (content: string) => ({
			data: [
				[
					{
						type: "attachment",
						source: "web:https://x.dev",
						content: { type: "web", title: "X", content },
					},
				],
			],
		});
		expect(
			ChatSourcesUtils.webSources({
				messages: [page("short"), page("much longer")] as never,
				toolsets: [],
			}),
		).toEqual([{ url: "https://x.dev", title: "X", content: "much longer" }]);
	});
});

describe("ChatSourcesUtils.files", () => {
	it("lists project folders and files calls changed, but not deleted ones", () => {
		const files = ChatSourcesUtils.files({
			mounted: [],
			folders: ["/repo"],
			messages: [
				{
					data: [
						[
							{
								type: "toolResult",
								id: "call",
								name: "shell_exec",
								output: [],
								changes: {
									files: [
										{ path: "/repo/a.ts", before: "a", after: "b" },
										{ path: "/repo/gone.ts", before: "a" },
										{ path: "/repo/pnpm-lock.yaml", skipped: "lockfile" },
									],
								},
							},
						],
					],
				},
			] as never,
			draft: { data: [] },
			loaded: [ChatSourcesUtils.local("/repo/src", true)],
			toolsets: [],
		});
		expect(files.map((file) => [file.path, file.directory])).toEqual([
			["/repo", true],
			["/repo/a.ts", false],
			["/repo/pnpm-lock.yaml", false],
			["/repo/src", true],
		]);
	});
});
