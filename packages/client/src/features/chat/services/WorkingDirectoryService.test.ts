import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkingDirectoryService } from "#client/features/chat/services/WorkingDirectoryService.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import type { ShellCapability } from "#core/core/types/capability.ts";

describe("WorkingDirectoryService", () => {
	let root: string;
	let cwd: string;
	let shell: ShellCapability;
	let directory: ReturnType<typeof WorkingDirectoryService.create> | undefined;
	beforeEach(async () => {
		useChatStore.getState().start(null);
		root = await mkdtemp(join(tmpdir(), "working-directory-"));
		await mkdir(join(root, "project", "nested"), { recursive: true });
		await mkdir(join(root, "other"));
		cwd = join(root, "project", "nested");
		shell = {
			exec: async () => {
				throw new Error("unused");
			},
			cwd: async () => cwd,
			chdir: async ({ path }) => {
				const next = resolve(cwd, path);
				if (!(await stat(next)).isDirectory())
					throw new Error("not a directory");
				cwd = next;
			},
			readFile: async () => {
				throw new Error("unused");
			},
			readDir: async () => [],
			writeFile: async ({ path }) => ({ path, success: true }),
		};
	});
	afterEach(async () => {
		directory?.dispose();
		useChatStore.getState().start(null);
		await rm(root, { recursive: true, force: true });
	});

	it("prefers a project containing the launch directory and skips unavailable folders", async () => {
		useChatStore.getState().open("chat");
		directory = WorkingDirectoryService.create({
			shell,
			activate: async () => ({
				id: "chat",
				projectCandidates: [
					join(root, "missing"),
					join(root, "other"),
					join(root, "project"),
				],
				candidates: [join(root, "project"), join(root, "other")],
			}),
		});
		await directory.ready();
		expect(cwd).toBe(join(root, "project"));
		expect(await directory.folders()).toEqual([
			join(root, "project"),
			join(root, "other"),
		]);
		expect(await directory.origin()).toBe(join(root, "project", "nested"));
		useChatStore.getState().start(null);
		await directory.ready();
		expect(cwd).toBe(await directory.origin());
		expect(await directory.folders()).toEqual([]);
	});

	it("resolves relative folders from the launch directory, never the preceding candidate", async () => {
		useChatStore.getState().open("chat");
		directory = WorkingDirectoryService.create({
			shell,
			activate: async () => ({
				id: "chat",
				projectCandidates: [],
				candidates: ["..", "../../other", "missing"],
			}),
		});
		await directory.ready();
		expect(await directory.folders()).toEqual(["..", "../../other"]);
		expect(cwd).toBe(join(root, "project"));
	});

	it("serializes rapid selections and recovers after an activation fails", async () => {
		const requests: (string | null)[] = [];
		const failure = new Error("activation failed");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			directory = WorkingDirectoryService.create({
				shell,
				activate: async ({ chatId }) => {
					requests.push(chatId);
					if (chatId === "bad") throw failure;
					return {
						id: chatId,
						candidates: [join(root, "other")],
						projectCandidates: [],
					};
				},
			});
			await directory.ready();
			useChatStore.getState().open("bad");
			await expect(directory.ready()).rejects.toBe(failure);
			expect(cwd).toBe(await directory.origin());
			useChatStore.getState().open("a");
			useChatStore.getState().open("b");
			await directory.ready();
			expect(requests).toEqual(["bad", "a", "b"]);
			expect(cwd).toBe(join(root, "other"));
		} finally {
			warn.mockRestore();
		}
	});

	it("activates server-only runtimes, deduplicates selections, and unsubscribes on disposal", async () => {
		const activate = vi.fn(async () => ({
			id: "chat",
			candidates: ["/remote"],
			projectCandidates: [],
		}));
		directory = WorkingDirectoryService.create({ activate });
		await directory.ready();
		expect(activate).not.toHaveBeenCalled();
		useChatStore.getState().open("chat");
		await directory.ready();
		useChatStore.getState().selectBranch(null, "message");
		await directory.ready();
		expect(activate).toHaveBeenCalledTimes(1);
		expect(await directory.origin()).toBeNull();
		directory.refresh();
		await directory.ready();
		expect(activate).toHaveBeenCalledTimes(2);
		directory.dispose();
		useChatStore.getState().open("other");
		await Promise.resolve();
		expect(activate).toHaveBeenCalledTimes(2);
	});
});
