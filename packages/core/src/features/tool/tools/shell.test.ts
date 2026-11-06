import type { DeepPartial } from "#core/core/types/common.ts";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import type { zSettings } from "#core/features/data/types/user.ts";
import { createShell } from "#core/features/file/services/FileSearchService.test.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { createEditPlanTool } from "#core/features/tool/tools/plan/edit_plan.ts";
import { createEditFilesTool } from "#core/features/tool/tools/shell/edit_files.ts";
import { createGlobFilesTool } from "#core/features/tool/tools/shell/glob_files.ts";
import { createGrepFilesTool } from "#core/features/tool/tools/shell/grep_files.ts";
import { createReadDirTool } from "#core/features/tool/tools/shell/read_dir.ts";
import { createReadFileTool } from "#core/features/tool/tools/shell/read_file.ts";
import { createShellExecTool } from "#core/features/tool/tools/shell/shell_exec.ts";

const context = {} as zAgentContext;

/** One `write` step, as the old `write_file` took it. */
const write = (path: string, content = "new") => ({
	steps: [{ action: "write" as const, path, content }],
});

/** One `edit` step, as the old `edit_file` took it. */
const edit = (input: {
	path: string;
	old_string: string;
	new_string: string;
}) => ({ steps: [{ action: "edit" as const, ...input }] });

const contextWithFolder = (path: string | null, whitelist: boolean = true) => {
	return {
		chat: {
			project:
				path === null
					? null
					: { title: null, settings: { folders: [{ path, whitelist }] } },
		},
	} satisfies DeepPartial<zAgentContext> as zAgentContext;
};

const contextWithSettings = (user: zSettings, folder?: zSettings) => {
	return {
		user: { settings: user },
		chat: { project: folder ? { title: null, settings: folder } : null },
	} satisfies DeepPartial<zAgentContext> as zAgentContext;
};

describe("shell", () => {
	it("returns a window of a long file and says how to read on", async () => {
		const shell = createShell({
			"/project/long.ts": Array.from(
				{ length: 5_000 },
				(_, index) => `line ${index + 1}`,
			).join("\n"),
		});
		const tool = await createReadFileTool({ capabilities: { shell } });

		const parts = await tool.execute({
			input: { path: "/project/long.ts" },
			feedback: undefined,
			context,
		});

		const file = parts.find((part) => part.type === "file");
		if (file?.type !== "file") throw new Error("Expected a file part");
		const text = FileUtils.getTextFromBytes(file) ?? "";

		expect(text.split("\n")).toHaveLength(1_000);
		expect(parts.at(-1)).toEqual({
			type: "text",
			value: expect.stringContaining("offset 1001"),
		});
	});

	it("refuses to pull an oversized binary into the conversation", async () => {
		const shell = createShell({
			"/project/blob.psd": new Uint8Array(6_000_000),
		});
		const tool = await createReadFileTool({ capabilities: { shell } });

		await expect(
			tool.execute({
				input: { path: "/project/blob.psd" },
				feedback: undefined,
				context,
			}),
		).rejects.toThrow(/too large/);
	});

	it("caps a directory listing and says it did", async () => {
		const files: Record<string, string> = {};
		for (let index = 0; index < 300; index++) {
			files[`/project/file-${index}.ts`] = "x";
		}
		const tool = await createReadDirTool({
			capabilities: { shell: createShell(files) },
		});

		const parts = await tool.execute({
			input: { path: "/project", max_results: 50 },
			feedback: undefined,
			context,
		});

		const listing = parts.filter((part) => part.type === "json");
		expect(listing).toHaveLength(50);
		expect(parts.at(-1)).toEqual({
			type: "text",
			value: expect.stringContaining("Showing 50 of 300"),
		});
	});

	it("truncates the middle of very long command output", async () => {
		const shell = {
			...createShell({}),
			exec: async () => ({
				code: 0,
				stdout: Array.from(
					{ length: 5_000 },
					(_, index) => `out ${index}`,
				).join("\n"),
				stderr: "",
			}),
		};
		const tool = await createShellExecTool({ capabilities: { shell } });

		const parts = await tool.execute({
			input: { command: "noisy", mnt: false },
			feedback: undefined,
			context,
		});

		const result = parts[0];
		if (result?.type !== "json") throw new Error("Expected a JSON result");
		expect(result.value.stdout).toContain("out 0");
		expect(result.value.stdout).toContain("out 4999");
		expect(result.value.stdout).toContain("characters of stdout omitted");
		expect(result.value.stdout.length).toBeLessThan(25_000);
	});

	it("reports command output as it arrives, and again in the result", async () => {
		const shell = {
			...createShell({}),
			exec: async ({
				stream,
			}: Parameters<ReturnType<typeof createShell>["exec"]>[0]) => {
				stream?.({ type: "stdout", value: "working" });
				stream?.({ type: "stderr", value: "careful" });
				stream?.({ type: "stdout", value: " done\n" });
				return { code: 0, stdout: "working done\n", stderr: "careful" };
			},
		};
		const tool = await createShellExecTool({ capabilities: { shell } });

		const chunks: { type: string; value: string }[] = [];
		const parts = await tool.execute({
			input: { command: "work", mnt: false },
			feedback: undefined,
			context,
			stream: (mutation) => {
				if (mutation.mode === "append") chunks.push(mutation.data);
				else if (mutation.mode === "replace")
					chunks[chunks.length - 1] = mutation.data;
			},
		});

		expect(chunks).toEqual([
			{ type: "stdout", value: "working" },
			{ type: "stderr", value: "careful" },
			{ type: "stdout", value: " done" },
			{ type: "stdout", value: "" },
		]);

		const result = parts[0];
		if (result?.type !== "json") throw new Error("Expected a JSON result");
		expect(result.value).toEqual({
			code: 0,
			stdout: "working done\n",
			stderr: "careful",
		});
	});

	it("reports search coverage alongside the matches", async () => {
		const shell = createShell({
			"/project/a.ts": "const needle = 1;\n",
			"/project/b.ts": "nothing here\n",
		});
		const tool = await createGrepFilesTool({ capabilities: { shell } });

		const parts = await tool.execute({
			input: { path: "/project", query: "needle" },
			feedback: undefined,
			context,
		});

		expect(parts[0]).toEqual({
			type: "json",
			value: {
				path: "/project/a.ts",
				snippet: "1: const needle = 1;",
				matches: 1,
			},
		});
		expect(parts.at(-1)).toEqual({
			type: "text",
			value: expect.stringContaining("Searched 2 of 2 file(s)"),
		});
	});

	it("lists paths matching a glob", async () => {
		const shell = createShell({
			"/project/src/a.test.ts": "a",
			"/project/src/a.ts": "b",
		});
		const tool = await createGlobFilesTool({ capabilities: { shell } });

		const parts = await tool.execute({
			input: { path: "/project", pattern: "**/*.test.ts" },
			feedback: undefined,
			context,
		});

		expect(parts).toEqual([
			{
				type: "json",
				value: "/project/src/a.test.ts",
			},
		]);
	});

	it("fails an unappliable edit on check, before it is written", async () => {
		const shell = createShell({ "/project/a.ts": "const a = 1;\n" });
		const tool = await createEditFilesTool({
			capabilities: { shell },
		});

		await expect(
			tool.validate?.({
				input: edit({
					path: "/project/a.ts",
					old_string: "const b = 2;",
					new_string: "const b = 3;",
				}),
				context,
			}),
		).rejects.toThrow(/not found in file/);

		const file = await shell.readFile({ path: "/project/a.ts" });
		expect(FileUtils.getTextFromBytes(file)).toBe("const a = 1;\n");
	});

	it("passes check for an edit that applies, without writing it", async () => {
		const shell = createShell({ "/project/a.ts": "const a = 1;\n" });
		const tool = await createEditFilesTool({
			capabilities: { shell },
		});
		const input = edit({
			path: "/project/a.ts",
			old_string: "const a = 1;",
			new_string: "const a = 2;",
		});

		await expect(
			tool.validate?.({ input, context }),
		).resolves.not.toBeUndefined();

		const before = await shell.readFile({ path: "/project/a.ts" });
		expect(FileUtils.getTextFromBytes(before)).toBe("const a = 1;\n");

		await tool.execute({ input, feedback: undefined, context });

		const after = await shell.readFile({ path: "/project/a.ts" });
		expect(FileUtils.getTextFromBytes(after)).toBe("const a = 2;\n");
	});

	it("runs steps in order, each against what the last left", async () => {
		const shell = createShell({
			"/project/a.ts": "const a = 1;\n",
			"/project/old/b.ts": "b",
			"/project/c.ts": "c",
		});
		const tool = await createEditFilesTool({ capabilities: { shell } });
		const input = {
			steps: [
				{ action: "write" as const, path: "/project/new.ts", content: "x = 1" },
				{
					action: "edit" as const,
					path: "/project/new.ts",
					old_string: "x = 1",
					new_string: "x = 2",
				},
				{
					action: "edit" as const,
					path: "/project/a.ts",
					old_string: "const a = 1;",
					new_string: "const a = 2;",
				},
				{
					action: "rename" as const,
					path: "/project/a.ts",
					to: "/project/z.ts",
				},
				{
					action: "edit" as const,
					path: "/project/z.ts",
					old_string: "const a = 2;",
					new_string: "const z = 2;",
				},
				{ action: "rename" as const, path: "/project/old", to: "/project/new" },
				{ action: "delete" as const, path: "/project/c.ts" },
			],
		};

		await tool.validate?.({ input, context });
		const [result] = await tool.execute({
			input,
			feedback: undefined,
			context,
		});

		const read = async (path: string) =>
			FileUtils.getTextFromBytes(await shell.readFile({ path }));
		expect(await read("/project/new.ts")).toBe("x = 2");
		expect(await read("/project/z.ts")).toBe("const z = 2;\n");
		expect(await read("/project/new/b.ts")).toBe("b");
		await expect(shell.readFile({ path: "/project/a.ts" })).rejects.toThrow();
		await expect(shell.readFile({ path: "/project/c.ts" })).rejects.toThrow();
		expect(result).toMatchObject({
			type: "json",
			value: { steps: expect.any(Array) },
		});
		if (result?.type !== "json") throw new Error("Expected a JSON result");
		expect(result.value.steps).toHaveLength(7);
		expect(result.value.steps.some((step) => step.error)).toBe(false);
	});

	it("fails the whole batch on check when a later step could never land", async () => {
		const shell = createShell({ "/project/a.ts": "const a = 1;\n" });
		const tool = await createEditFilesTool({ capabilities: { shell } });

		await expect(
			tool.validate?.({
				input: {
					steps: [
						{ action: "write", path: "/project/b.ts", content: "b" },
						{ action: "delete", path: "/project/a.ts" },
						{
							action: "edit",
							path: "/project/a.ts",
							old_string: "const a = 1;",
							new_string: "const a = 2;",
						},
					],
				},
				context,
			}),
		).rejects.toThrow(/Step 3 .*no steps were applied/);
		await expect(shell.readFile({ path: "/project/b.ts" })).rejects.toThrow();
	});

	it("stops at the first step that fails as it runs, and says what it skipped", async () => {
		const shell = createShell({});
		const tool = await createEditFilesTool({ capabilities: { shell } });

		const [result] = await tool.execute({
			input: {
				steps: [
					{ action: "write", path: "/project/a.ts", content: "a" },
					{ action: "delete", path: "/project/missing.ts" },
					{ action: "write", path: "/project/b.ts", content: "b" },
				],
			},
			feedback: undefined,
			context,
		});

		if (result?.type !== "json") throw new Error("Expected a JSON result");
		expect(result.value.skipped).toBe(1);
		expect(result.value.steps[1]?.error).toMatch(/Missing file/);
		await expect(shell.readFile({ path: "/project/b.ts" })).rejects.toThrow();
	});

	it("requires approval when a rename lands outside the active folder", async () => {
		const tool = await createEditFilesTool({
			capabilities: { shell: createShell({ "/project/a.ts": "a" }) },
		});

		await expect(
			tool.validate?.({
				input: {
					steps: [
						{ action: "rename", path: "/project/a.ts", to: "/elsewhere/a.ts" },
					],
				},
				context: contextWithFolder("/project"),
			}),
		).resolves.toEqual({ approval: true });
	});

	it("writes and edits the chat's plan, wherever the steps say", async () => {
		const chatShell = createShell({ "/mnt/chat/c1/plan.md": "" });
		const tool = await createEditPlanTool({ capabilities: { chatShell } });
		const planContext = {
			chat: { id: "c1" },
		} satisfies DeepPartial<zAgentContext> as zAgentContext;
		const input = {
			steps: [
				{ action: "write" as const, content: "# Plan\n\n- [ ] One\n" },
				{
					action: "edit" as const,
					old_string: "- [ ] One",
					new_string: "- [x] One",
				},
			],
		};

		await expect(
			tool.validate?.({ input, context: planContext }),
		).resolves.toEqual({ approval: false });
		await tool.execute({ input, feedback: undefined, context: planContext });

		const plan = await chatShell.readFile({ path: "/mnt/chat/c1/plan.md" });
		expect(FileUtils.getTextFromBytes(plan)).toBe("# Plan\n\n- [x] One\n");
	});

	it("skips approval for file writes inside the active folder when enabled", async () => {
		const tool = await createEditFilesTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: write("/project/src/new.ts"),
				context: contextWithFolder("/project", true),
			}),
		).resolves.toEqual({ approval: false });

		await expect(
			tool.validate?.({
				input: write("/project/src/new.ts"),
				context: contextWithFolder("/project", false),
			}),
		).resolves.toEqual({ approval: true });
	});

	it("treats filesystem roots as active folders", async () => {
		const tool = await createEditFilesTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: write("/new.ts"),
				context: contextWithFolder("/"),
			}),
		).resolves.toEqual({ approval: false });
		await expect(
			tool.validate?.({
				input: write("c:\\project\\new.ts"),
				context: contextWithFolder("C:\\PROJECT"),
			}),
		).resolves.toEqual({ approval: false });
	});

	it("skips approval for file edits inside the active folder", async () => {
		const tool = await createEditFilesTool({
			capabilities: {
				shell: createShell({ "/project/src/a.ts": "const a = 1;\n" }),
			},
		});

		await expect(
			tool.validate?.({
				input: edit({
					path: "/project/src/a.ts",
					old_string: "const a = 1;",
					new_string: "const a = 2;",
				}),
				context: contextWithFolder("/project"),
			}),
		).resolves.toEqual({ approval: false });
	});

	it("skips approval for writes inside app-wide or folder writable folders", async () => {
		const tool = await createEditFilesTool({
			capabilities: { shell: createShell({}) },
		});
		const validate = (path: string, context: zAgentContext) =>
			tool.validate?.({ input: write(path), context });
		const context = contextWithSettings(
			{
				folders: [
					{ path: "/app", whitelist: true },
					{ path: "/shared", whitelist: true },
				],
			},
			{
				folders: [
					{ path: "/project", whitelist: true },
					{ path: "/shared", whitelist: false },
				],
			},
		);

		await expect(validate("/app/new.ts", context)).resolves.toEqual({
			approval: false,
		});
		await expect(validate("/project/new.ts", context)).resolves.toEqual({
			approval: false,
		});
		// The folder's own entry wins over the app-wide one for the same path.
		await expect(validate("/shared/new.ts", context)).resolves.toEqual({
			approval: true,
		});
	});

	it("skips approval for commands matching a whitelist pattern", async () => {
		const tool = await createShellExecTool({
			capabilities: { shell: createShell({}) },
		});
		const validate = (command: string) =>
			tool.validate?.({
				input: { command, mnt: false },
				context: contextWithSettings(
					{ commands: [{ command: "npm run *", whitelist: true }] },
					{ commands: [{ command: "pnpm test", whitelist: true }] },
				),
			});

		await expect(validate("npm run build && pnpm test")).resolves.toEqual({
			approval: false,
		});
		await expect(validate("echo $(npm run lint)")).resolves.toEqual({
			approval: false,
		});
		await expect(validate("pnpm test --watch")).resolves.toEqual({
			approval: true,
		});
		await expect(validate("npm run build && rm -rf dist")).resolves.toEqual({
			approval: true,
		});
	});

	it("requires approval for file writes outside the active folder", async () => {
		const tool = await createEditFilesTool({
			capabilities: { shell: createShell({}) },
		});
		const input = write("/project-other/new.ts");

		await expect(
			tool.validate?.({ input, context: contextWithFolder("/project") }),
		).resolves.toEqual({ approval: true });
		await expect(
			tool.validate?.({ input, context: contextWithFolder(null) }),
		).resolves.toEqual({ approval: true });
	});

	it("requires approval when a file path escapes the active folder", async () => {
		const tool = await createEditFilesTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: write("/project/src/../../outside.ts", "outside"),
				context: contextWithFolder("/project"),
			}),
		).resolves.toEqual({ approval: true });
	});

	it.each([
		["/var/folders/user/T", "/var/folders/user/T/scratch.txt", false],
		["/var/folders/user/T", "/var/folders/user/T/../outside.txt", true],
		["/var/folders/user/T", "/var/folders/user/T-other/scratch.txt", true],
		["C:/Users/me/Temp", "c:/users/ME/temp/scratch.txt", false],
		["C:/Users/me/Temp", "C:/Users/me/Temp/../outside.txt", true],
		["/scratch", "./scratch.txt", false],
	])("checks OS temp directory %s for %s", async (tmpdir, path, approval) => {
		const tool = await createEditFilesTool({
			capabilities: {
				shell: {
					...createShell({}),
					tmpdir: async () => tmpdir,
					cwd: async () => "/scratch",
				},
			},
		});
		await expect(
			tool.validate?.({ input: write(path), context: contextWithFolder(null) }),
		).resolves.toEqual({ approval });
	});

	it("compares native paths using the shell's spelling of the temp directory", async () => {
		const tool = await createEditFilesTool({
			capabilities: {
				shell: {
					...createShell({}),
					tmpdir: async () => "/c/Users/me/Temp",
					toShellPath: ({ path }) => path.replace(/^C:/, "/c"),
				},
			},
		});
		await expect(
			tool.validate?.({
				input: write("C:/Users/me/Temp/a.txt"),
				context: contextWithFolder(null),
			}),
		).resolves.toEqual({ approval: false });
	});

	it("checks both ends of renames involving temporary files", async () => {
		const tool = await createEditFilesTool({
			capabilities: {
				shell: {
					...createShell({
						"/scratch/source.txt": "source",
						"/outside/source.txt": "source",
					}),
					tmpdir: async () => "/scratch",
				},
			},
		});
		for (const [path, to, approval] of [
			["/scratch/source.txt", "/scratch/dest.txt", false],
			["/scratch/source.txt", "/outside/dest.txt", true],
			["/outside/source.txt", "/scratch/dest.txt", true],
		] as const) {
			await expect(
				tool.validate?.({
					input: { steps: [{ action: "rename", path, to }] },
					context: contextWithFolder(null),
				}),
			).resolves.toEqual({ approval });
		}
	});

	it("skips approval for a whitelisted command", async () => {
		const tool = await createShellExecTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({ input: { command: "ls -la", mnt: false }, context }),
		).resolves.toEqual({ approval: false });
	});

	it("skips approval for a chain of whitelisted commands", async () => {
		const tool = await createShellExecTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: {
					command: "git status && git diff && cat README.md",
					mnt: false,
				},
				context,
			}),
		).resolves.toEqual({ approval: false });
	});

	it("requires approval for a command outside the whitelist", async () => {
		const tool = await createShellExecTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({ input: { command: "rm -rf /", mnt: false }, context }),
		).resolves.toEqual({ approval: true });
	});

	it("requires approval when any command in a chain is unsafe", async () => {
		const tool = await createShellExecTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: { command: "ls && rm -rf /", mnt: false },
				context,
			}),
		).resolves.toEqual({ approval: true });
	});

	it("requires approval for commands using unparsed shell features", async () => {
		const tool = await createShellExecTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: { command: "ls | rm -rf /", mnt: false },
				context,
			}),
		).resolves.toEqual({ approval: true });
	});
});
