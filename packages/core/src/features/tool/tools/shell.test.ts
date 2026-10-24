import type { DeepPartial } from "#core/core/types/common.ts";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import type { zSettings } from "#core/features/data/types/user.ts";
import { createShell } from "#core/features/file/services/FileSearchService.test.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { createEditFileTool } from "#core/features/tool/tools/shell/edit_file.ts";
import { createGlobFilesTool } from "#core/features/tool/tools/shell/glob_files.ts";
import { createGrepFilesTool } from "#core/features/tool/tools/shell/grep_files.ts";
import { createReadDirTool } from "#core/features/tool/tools/shell/read_dir.ts";
import { createReadFileTool } from "#core/features/tool/tools/shell/read_file.ts";
import { createShellExecTool } from "#core/features/tool/tools/shell/shell_exec.ts";
import { createWriteFileTool } from "#core/features/tool/tools/shell/write_file.ts";

const context = {} as zAgentContext;

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
		const tool = await createEditFileTool({
			capabilities: { shell },
		});

		await expect(
			tool.validate?.({
				input: {
					path: "/project/a.ts",
					old_string: "const b = 2;",
					new_string: "const b = 3;",
				},
				context,
			}),
		).rejects.toThrow(/not found in file/);

		const file = await shell.readFile({ path: "/project/a.ts" });
		expect(FileUtils.getTextFromBytes(file)).toBe("const a = 1;\n");
	});

	it("passes check for an edit that applies, without writing it", async () => {
		const shell = createShell({ "/project/a.ts": "const a = 1;\n" });
		const tool = await createEditFileTool({
			capabilities: { shell },
		});
		const input = {
			path: "/project/a.ts",
			old_string: "const a = 1;",
			new_string: "const a = 2;",
		};

		await expect(
			tool.validate?.({ input, context }),
		).resolves.not.toBeUndefined();

		const before = await shell.readFile({ path: "/project/a.ts" });
		expect(FileUtils.getTextFromBytes(before)).toBe("const a = 1;\n");

		await tool.execute({ input, feedback: undefined, context });

		const after = await shell.readFile({ path: "/project/a.ts" });
		expect(FileUtils.getTextFromBytes(after)).toBe("const a = 2;\n");
	});

	it("skips approval for file writes inside the active folder when enabled", async () => {
		const tool = await createWriteFileTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: { path: "/project/src/new.ts", content: "new" },
				context: contextWithFolder("/project", true),
			}),
		).resolves.toEqual({ approval: false });

		await expect(
			tool.validate?.({
				input: { path: "/project/src/new.ts", content: "new" },
				context: contextWithFolder("/project", false),
			}),
		).resolves.toEqual({ approval: true });
	});

	it("treats filesystem roots as active folders", async () => {
		const tool = await createWriteFileTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: { path: "/new.ts", content: "new" },
				context: contextWithFolder("/"),
			}),
		).resolves.toEqual({ approval: false });
		await expect(
			tool.validate?.({
				input: { path: "c:\\project\\new.ts", content: "new" },
				context: contextWithFolder("C:\\PROJECT"),
			}),
		).resolves.toEqual({ approval: false });
	});

	it("skips approval for file edits inside the active folder", async () => {
		const tool = await createEditFileTool({
			capabilities: {
				shell: createShell({ "/project/src/a.ts": "const a = 1;\n" }),
			},
		});

		await expect(
			tool.validate?.({
				input: {
					path: "/project/src/a.ts",
					old_string: "const a = 1;",
					new_string: "const a = 2;",
				},
				context: contextWithFolder("/project"),
			}),
		).resolves.toEqual({ approval: false });
	});

	it("skips approval for writes inside app-wide or folder writable folders", async () => {
		const tool = await createWriteFileTool({
			capabilities: { shell: createShell({}) },
		});
		const validate = (path: string, context: zAgentContext) =>
			tool.validate?.({ input: { path, content: "new" }, context });
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
		const tool = await createWriteFileTool({
			capabilities: { shell: createShell({}) },
		});
		const input = { path: "/project-other/new.ts", content: "new" };

		await expect(
			tool.validate?.({ input, context: contextWithFolder("/project") }),
		).resolves.toEqual({ approval: true });
		await expect(
			tool.validate?.({ input, context: contextWithFolder(null) }),
		).resolves.toEqual({ approval: true });
	});

	it("requires approval when a file path escapes the active folder", async () => {
		const tool = await createWriteFileTool({
			capabilities: { shell: createShell({}) },
		});

		await expect(
			tool.validate?.({
				input: {
					path: "/project/src/../../outside.ts",
					content: "outside",
				},
				context: contextWithFolder("/project"),
			}),
		).resolves.toEqual({ approval: true });
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
