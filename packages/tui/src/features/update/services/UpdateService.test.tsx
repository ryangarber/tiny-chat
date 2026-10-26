import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpdateService } from "#tui/features/update/services/UpdateService.ts";

let directory: string;
let binary: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "tiny-chat-update-"));
	binary = join(directory, "tiny-chat");
	await writeFile(binary, "working build", { mode: 0o751 });
	vi.spyOn(UpdateService, "binary").mockReturnValue(binary);
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});

describe("CLI release installation", () => {
	it("replaces a binary only after download and preserves executable permissions", async () => {
		const originalMode = (await stat(binary)).mode & 0o777;
		const fetch = vi.fn(async () => {
			expect(await readFile(binary, "utf8")).toBe("working build");
			return new Response("new build", { headers: { "content-length": "9" } });
		});
		vi.stubGlobal("fetch", fetch);
		const progress: (number | null)[] = [];
		await UpdateService.install({ onProgress: (p) => progress.push(p) });
		expect(await readFile(binary, "utf8")).toBe("new build");
		expect((await stat(binary)).mode & 0o777).toBe(originalMode);
		expect(progress.at(-1)).toBe(1);
		await expect(stat(`${binary}.download`)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("reports unknown progress when the server omits content length", async () => {
		vi.stubGlobal("fetch", async () => new Response("new build"));
		const onProgress = vi.fn();
		await UpdateService.install({ onProgress });
		expect(onProgress).toHaveBeenCalledWith(null);
	});

	it("keeps the working binary and removes a partial download when streaming fails", async () => {
		const failure = new Error("connection interrupted");
		let chunks = 0;
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							if (chunks++ === 0)
								controller.enqueue(new TextEncoder().encode("partial"));
							else controller.error(failure);
						},
					}),
				),
		);
		await expect(UpdateService.install()).rejects.toThrow(
			"connection interrupted",
		);
		expect(await readFile(binary, "utf8")).toBe("working build");
		await expect(stat(`${binary}.download`)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("rejects an HTTP failure without changing the current binary", async () => {
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(null, { status: 503, statusText: "Unavailable" }),
		);
		await expect(UpdateService.install()).rejects.toThrow("503 Unavailable");
		expect(await readFile(binary, "utf8")).toBe("working build");
	});

	it("refuses to update a source build before making any network request", async () => {
		vi.mocked(UpdateService.binary).mockReturnValue(null);
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(UpdateService.install()).rejects.toThrow(
			"cannot update itself",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("cleans only stale installer files", async () => {
		await writeFile(`${binary}.download`, "partial");
		await writeFile(`${binary}.old`, "old build");
		await UpdateService.clean();
		await UpdateService.clean();
		expect(await readFile(binary, "utf8")).toBe("working build");
		await expect(stat(`${binary}.download`)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(stat(`${binary}.old`)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it.each([
		["1.10.0", "1.9.9", true],
		["2.0.0", "1.99.99", true],
		["1.2", "1.2.0", false],
		["1.2.3+build", "1.2.3", false],
		["1.2.3-beta", "1.2.3", false],
		["0.9.0", "1.0.0", false],
	])("compares release numbers %s and %s", (a, b, expected) => {
		expect(UpdateService.isNewer(a, b)).toBe(expected);
	});
});
