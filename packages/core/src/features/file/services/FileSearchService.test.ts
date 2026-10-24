import type { ShellCapability } from "#core/core/types/capability.ts";
import { FileExtractionService } from "#core/features/file/services/FileExtractionService.ts";
import { FileSearchService } from "#core/features/file/services/FileSearchService.ts";
import { FileFixtureUtils } from "#core/features/file/utils/FileFixtureUtils.ts";

export const createShell = (
	initial: Record<string, string | Uint8Array>,
): ShellCapability => {
	const files = new Map(Object.entries(initial));
	return {
		readFile: async ({ path }) => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`Missing file: ${path}`);
			return {
				path,
				data:
					typeof content === "string"
						? new TextEncoder().encode(content)
						: content,
			};
		},
		readDir: async ({ path }) => {
			const prefix = path.endsWith("/") ? path : `${path}/`;
			const entries = new Map<string, boolean>();
			for (const filePath of files.keys()) {
				if (!filePath.startsWith(prefix)) continue;
				const remainder = filePath.slice(prefix.length);
				const [name, ...rest] = remainder.split("/");
				entries.set(`${prefix}${name}`, rest.length > 0);
			}
			return [...entries].map(([entryPath, is_dir]) => ({
				path: entryPath,
				is_dir,
			}));
		},
		writeFile: async ({ path, content }) => {
			files.set(path, content);
			return { path, success: true };
		},
		exec: async () => ({ stdout: "", stderr: "" }),
	};
};

describe("FileSearchService", () => {
	it("skips dependency and build directories", async () => {
		const shell = createShell({
			"/project/src/app.ts": "app",
			"/project/node_modules/dep/index.js": "dep",
			"/project/dist/app.js": "built",
		});

		const { entries } = await FileSearchService.walk({
			shell,
			path: "/project",
		});

		expect(entries.map((entry) => entry.path)).toEqual(["/project/src/app.ts"]);
	});

	// Git itself cannot re-include a file whose parent directory is ignored,
	// and neither does the walk: `ignored/` is never descended into.
	it("honours .gitignore when searching", async () => {
		const shell = createShell({
			"/project/.gitignore": "*.log\nignored/\n!ignored/keep.ts\n",
			"/project/app.ts": "app",
			"/project/debug.log": "noise",
			"/project/ignored/schema.ts": "generated",
			"/project/ignored/keep.ts": "kept",
		});

		const { entries } = await FileSearchService.walk({
			shell,
			path: "/project",
		});

		expect(entries.map((entry) => entry.path)).toEqual([
			"/project/.gitignore",
			"/project/app.ts",
		]);
	});

	// What a project does not track and what a user did not send are
	// different claims, and only the first is `.gitignore`'s to make.
	it("ignores .gitignore when listing", async () => {
		const shell = createShell({
			"/project/.gitignore": "*.log\n",
			"/project/app.ts": "app",
			"/project/debug.log": "noise",
		});

		const { entries } = await FileSearchService.walk({
			shell,
			path: "/project",
			scope: "listing",
		});

		expect(entries.map((entry) => entry.path)).toContain("/project/debug.log");
	});

	it("lists the files a text search would refuse to open", async () => {
		const shell = createShell({
			"/project/screenshot.png": "binary",
			"/project/run.log": "noise",
			"/project/dist/app.js": "built",
			"/project/node_modules/dep/index.js": "dep",
		});

		const { entries } = await FileSearchService.walk({
			shell,
			path: "/project",
			scope: "listing",
		});

		expect(entries.map((entry) => entry.path).sort()).toEqual([
			"/project/dist/app.js",
			"/project/run.log",
			"/project/screenshot.png",
		]);
	});

	it("names a directory it declined to descend into", async () => {
		const shell = createShell({
			"/project/app.ts": "app",
			"/project/node_modules/dep/index.js": "dep",
		});

		const { entries, skipped } = await FileSearchService.walk({
			shell,
			path: "/project",
			scope: "listing",
			includeDirectories: true,
		});

		expect(entries).toEqual([
			{ path: "/project/app.ts", is_dir: false },
			{
				path: "/project/node_modules",
				is_dir: true,
				skipped: "dependency",
			},
		]);
		expect(skipped).toEqual({ dependency: 1 });
	});

	// A checkout that happens to sit in a directory named after build
	// output must not rule out every file inside it.
	it("judges paths from the search root down", async () => {
		const shell = createShell({
			"/Users/me/Library/work/src/app.ts": "app",
			"/Users/me/Library/work/dist/app.js": "built",
		});

		const { entries } = await FileSearchService.walk({
			shell,
			path: "/Users/me/Library/work",
		});

		expect(entries.map((entry) => entry.path)).toEqual([
			"/Users/me/Library/work/src/app.ts",
		]);
	});

	it("reports truncation instead of walking forever", async () => {
		const files: Record<string, string> = {};
		for (let index = 0; index < 50; index++) {
			files[`/project/file-${index}.ts`] = "x";
		}

		const { entries, truncated } = await FileSearchService.walk({
			shell: createShell(files),
			path: "/project",
			maxEntries: 10,
		});

		expect(entries).toHaveLength(10);
		expect(truncated).toBe(true);
	});

	// A native walk lists everything it was not told to prune, so what it
	// returns has to be held to the same rules a `readDir` walk applies.
	it("filters a native walk the same way", async () => {
		const files = {
			"/project/.gitignore": "ignored/\n",
			"/project/src/app.ts": "app",
			"/project/ignored/schema.ts": "generated",
			"/project/cmake-build-debug/out.o": "built",
			"/project/target/debug/main": "built",
		};
		const shell = createShell(files);
		const pruned: string[][] = [];
		shell.walk = async ({ path, prune }) => {
			pruned.push(prune);
			const paths = new Set<string>();
			for (const file of Object.keys(files)) {
				const parts = file.slice(path.length + 1).split("/");
				for (let index = 1; index <= parts.length; index++)
					paths.add(`${path}/${parts.slice(0, index).join("/")}`);
			}
			return {
				root: path,
				entries: [...paths].map((entry) => ({
					path: entry,
					is_dir: !(entry in files),
				})),
				truncated: false,
			};
		};

		const { entries } = await FileSearchService.walk({
			shell,
			path: "/project",
			scope: "lookup",
		});

		expect(pruned[0]).toContain("target");
		expect(entries.map((entry) => entry.path).sort()).toEqual([
			"/project/.gitignore",
			"/project/src/app.ts",
		]);
	});

	it("leaves build output out of a lookup but not media", async () => {
		const shell = createShell({
			"/project/logo.png": "png",
			"/project/target/debug/main.rs": "built",
			"/project/src/main.rs": "fn main() {}",
		});

		const { entries } = await FileSearchService.walk({
			shell,
			path: "/project",
			scope: "lookup",
		});

		expect(entries.map((entry) => entry.path).sort()).toEqual([
			"/project/logo.png",
			"/project/src/main.rs",
		]);
	});

	it("returns numbered lines and a coverage summary", async () => {
		const shell = createShell({
			"/project/a.ts": "const answer = 42;\nconst other = 1;\n",
			"/project/b.ts": "const answer = 'unknown';\n",
		});

		const report = await FileSearchService.grep({
			shell,
			path: "/project",
			query: "answer\\s*=\\s*42",
		});

		expect(report.results).toEqual([
			{ path: "/project/a.ts", snippet: "1: const answer = 42;", matches: 1 },
		]);
		expect(report.summary).toContain("1 match(es) in 1 file(s)");
	});

	it("searches a single file when the path names one", async () => {
		const shell = createShell({
			"/project/a.ts": "const answer = 42;\n",
			"/project/node_modules/dep/index.js": "const answer = 'dep';\n",
		});
		// Some shells throw when asked to list a file rather than listing nothing.
		const strict: ShellCapability = {
			...shell,
			readDir: async ({ path }) => {
				if (path.endsWith(".ts")) throw new Error(`Not a directory: ${path}`);
				return await shell.readDir({ path });
			},
		};

		for (const current of [shell, strict])
			await expect(
				FileSearchService.grep({
					shell: current,
					path: "/project/a.ts",
					query: "answer",
				}),
			).resolves.toMatchObject({
				results: [{ path: "/project/a.ts", matches: 1 }],
			});

		await expect(
			FileSearchService.grep({
				shell,
				path: "/project/node_modules/dep/index.js",
				query: "answer",
			}),
		).resolves.toMatchObject({
			results: [{ path: "/project/node_modules/dep/index.js" }],
		});

		await expect(
			FileSearchService.grep({
				shell: strict,
				path: "/project/missing.ts",
				query: "answer",
			}),
		).rejects.toThrow("Not a directory");
	});

	it("is case-insensitive until the query says otherwise", async () => {
		const shell = createShell({ "/project/a.ts": "const Answer = 1;\n" });

		await expect(
			FileSearchService.grep({ shell, path: "/project", query: "answer" }),
		).resolves.toMatchObject({ results: [{ path: "/project/a.ts" }] });

		await expect(
			FileSearchService.grep({ shell, path: "/project", query: "ANSWER" }),
		).resolves.toMatchObject({ results: [] });
	});

	it("caps what a single file may contribute", async () => {
		const shell = createShell({
			"/project/a.ts": "match\n".repeat(1_000),
		});

		const report = await FileSearchService.grep({
			shell,
			path: "/project",
			query: "match",
		});

		expect(report.results[0].matches).toBe(1_000);
		expect(report.results[0].snippet.split("\n").length).toBeLessThanOrEqual(
			10,
		);
		expect(report.summary).toContain("1000 match(es)");
	});

	it("skips minified, generated and binary files", async () => {
		const shell = createShell({
			"/project/bundle.js": `const needle = 1;${"x".repeat(6_000)}`,
			"/project/schema.ts": `// Code generated by prisma. DO NOT EDIT.\nconst needle = 2;\n`,
			"/project/blob.txt": new Uint8Array([110, 0, 1, 2, 3]),
			"/project/real.ts": "const needle = 3;\n",
		});

		const report = await FileSearchService.grep({
			shell,
			path: "/project",
			query: "needle",
		});

		expect(report.results.map((result) => result.path)).toEqual([
			"/project/real.ts",
		]);
		expect(report.stats.skipped).toMatchObject({
			minified: 1,
			generated: 1,
			binary: 1,
		});
	});

	it("filters by an include glob", async () => {
		const shell = createShell({
			"/project/src/a.ts": "needle",
			"/project/src/a.test.ts": "needle",
		});

		const report = await FileSearchService.grep({
			shell,
			path: "/project",
			query: "needle",
			include: "**/*.test.ts",
		});

		expect(report.results.map((result) => result.path)).toEqual([
			"/project/src/a.test.ts",
		]);
	});

	it("explains an unusable regular expression", async () => {
		await expect(
			FileSearchService.grep({
				shell: createShell({ "/project/a.ts": "a" }),
				path: "/project",
				query: "(unclosed",
			}),
		).rejects.toThrow(/Invalid regular expression/);
	});

	it("matches literally when asked", async () => {
		const shell = createShell({
			"/project/a.ts": "const cost = a[0] + b;\n",
		});

		await expect(
			FileSearchService.grep({
				shell,
				path: "/project",
				query: "a[0]",
				literal: true,
			}),
		).resolves.toMatchObject({ results: [{ path: "/project/a.ts" }] });
	});

	it("ranks the defining file above one that repeats the term", async () => {
		const shell = createShell({
			"/project/src/user-service.ts":
				"export const getUserSession = () => session;",
			"/project/src/log.ts": "user session\n".repeat(500),
		});

		const report = await FileSearchService.search({
			shell,
			path: "/project",
			query: "getUserSession",
		});

		expect(report.results[0].path).toBe("/project/src/user-service.ts");
	});

	it("keeps every result within the snippet budget", async () => {
		const files: Record<string, string> = {};
		for (let index = 0; index < 20; index++) {
			files[`/project/file-${index}.ts`] = "const user = 1;\n".repeat(2_000);
		}

		const report = await FileSearchService.search({
			shell: createShell(files),
			path: "/project",
			query: "user",
			maxResults: 10,
		});

		const total = report.results.reduce(
			(length, result) => length + result.snippet.length,
			0,
		);
		expect(report.results).toHaveLength(10);
		expect(total).toBeLessThanOrEqual(8_000);
	});

	it("finds files by path when the contents say nothing", async () => {
		const shell = createShell({
			"/project/src/checkout/index.ts": "export {};",
			"/project/src/other.ts": "export {};",
		});

		const report = await FileSearchService.search({
			shell,
			path: "/project",
			query: "checkout",
		});

		expect(report.results.map((result) => result.path)).toEqual([
			"/project/src/checkout/index.ts",
		]);
	});

	it("returns paths matching a pattern without reading them", async () => {
		const shell = createShell({
			"/project/src/a.ts": "a",
			"/project/src/b.tsx": "b",
			"/project/readme.md": "c",
		});

		await expect(
			FileSearchService.glob({ shell, path: "/project", pattern: "**/*.ts" }),
		).resolves.toEqual({
			paths: ["/project/src/a.ts"],
			truncated: false,
			scanned: 3,
		});
	});

	// The reason this tool exists: an attached upload is reached by globbing
	// the directory it was mounted at, and what was attached is usually
	// exactly what a text search would have thrown away.
	it("finds the uploaded files a text search would skip", async () => {
		const shell = createShell({
			"/mnt/uploads/abc/design/logo.png": "binary",
			"/mnt/uploads/abc/design/hero.jpg": "binary",
			"/mnt/uploads/abc/notes.md": "notes",
		});

		await expect(
			FileSearchService.glob({
				shell,
				path: "/mnt/uploads/abc",
				pattern: "**/*.{png,jpg}",
			}),
		).resolves.toMatchObject({
			paths: [
				"/mnt/uploads/abc/design/hero.jpg",
				"/mnt/uploads/abc/design/logo.png",
			],
		});
	});

	it("decodes an ordinary text file", async () => {
		const shell = createShell({ "/project/src/app.ts": "export {};" });

		await expect(
			FileSearchService.readSearchable({
				shell,
				path: "/project/src/app.ts",
			}),
		).resolves.toEqual({ reason: null, text: "export {};" });
	});

	// A document goes to the converter rather than to the binary check, so a
	// broken one comes back unreadable rather than being written off by type.
	it("sends a document to the converter instead of calling it binary", async () => {
		const shell = createShell({
			"/mnt/uploads/abc/handbook.pdf": new Uint8Array([37, 80, 68, 70, 0, 1]),
		});

		await expect(
			FileSearchService.readSearchable({
				shell,
				path: "/mnt/uploads/abc/handbook.pdf",
			}),
		).resolves.toEqual({ reason: "unreadable" });
	});

	// The whole point of unpacking documents: a contract someone attached is
	// searchable by what it says, not just by what it is called.
	it("matches text that only exists inside a document", async () => {
		const shell = createShell({
			"/mnt/uploads/abc/contract.pdf": FileFixtureUtils.buildPdf({
				sentence: "Termination clause: 30 days.",
			}),
			"/mnt/uploads/abc/notes.md": "nothing relevant",
		});

		const report = await FileSearchService.grep({
			shell,
			path: "/mnt/uploads/abc",
			query: "termination",
		});

		expect(report.results).toMatchObject([
			{ path: "/mnt/uploads/abc/contract.pdf", matches: 1 },
		]);
	});

	it("does not open a document past the size it is worth opening", async () => {
		const shell = createShell({
			"/mnt/uploads/abc/huge.pdf": new Uint8Array(
				FileExtractionService.maxBytes + 1,
			),
		});

		await expect(
			FileSearchService.readSearchable({
				shell,
				path: "/mnt/uploads/abc/huge.pdf",
			}),
		).resolves.toEqual({ reason: "large" });
	});

	// Where every call to the shell is a slow round trip (a WSL tree read from
	// Windows), a search has to cost a handful of calls, not one per file.
	it("reads in bulk and never opens a file the walk says is too large", async () => {
		const files: Record<string, string> = {
			"/project/.gitignore": "ignored.ts",
			"/project/ignored.ts": "needle",
			"/project/huge.ts": "needle".repeat(200_000),
		};
		for (let index = 0; index < 40; index++)
			files[`/project/src/file${index}.ts`] = index === 7 ? "needle" : "hay";

		const base = createShell(files);
		const calls = { readFile: 0, readFiles: [] as string[][] };
		const shell: ShellCapability = {
			...base,
			readFile: async (input) => {
				calls.readFile++;
				return await base.readFile(input);
			},
			readFiles: async ({ paths, maxBytes }) => {
				calls.readFiles.push(paths);
				return await Promise.all(
					paths.map(async (path) => {
						const { data } = await base.readFile({ path });
						return { data: data.subarray(0, maxBytes), size: data.length };
					}),
				);
			},
			walk: async ({ path }) => ({
				root: path,
				entries: [
					{ path: "/project/src", is_dir: true },
					...Object.entries(files).map(([file, content]) => ({
						path: file,
						is_dir: false,
						size: content.length,
					})),
				],
				truncated: false,
			}),
		};

		for (const report of [
			await FileSearchService.grep({
				shell,
				path: "/project",
				query: "needle",
			}),
			await FileSearchService.search({
				shell,
				path: "/project",
				query: "needle",
			}),
		]) {
			expect(report.results.map((result) => result.path)).toEqual([
				"/project/src/file7.ts",
			]);
			expect(report.stats.skipped.large).toBe(1);
		}

		const read = calls.readFiles.flat();
		expect(calls.readFile).toBe(0);
		expect(read).not.toContain("/project/huge.ts");
		expect(read).not.toContain("/project/ignored.ts");
		// One read of the `.gitignore`s, then two batches for grep and one for
		// search.
		expect(calls.readFiles.length).toBeLessThanOrEqual(6);
	});
});
