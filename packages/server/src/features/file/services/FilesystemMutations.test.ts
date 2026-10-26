import { mockConfig } from "#core/tests.ts";
import { FilesystemService } from "#server/features/file/services/FilesystemService.ts";
import { testClient } from "#server/tests.ts";

const { user, api } = testClient();
const other = testClient();
let fs: FilesystemService;
let base: string;
let chat: string;

beforeEach(async () => {
	const message = await api.message.createMessage.mutate({
		author: "USER",
		config: mockConfig(),
		data: [],
		metadata: [],
	});
	chat = message.chatId;
	base = `/mnt/chat/${chat}`;
	fs = new FilesystemService({ user, chat });
	await fs.fetch();
});
afterEach(async () => {
	await api.chat.deleteChat.mutate(chat);
});

describe("virtual filesystem mutations", () => {
	it.each(["utf8", "base64", "hex", "latin1"] as const)(
		"round trips binary and Unicode content using %s",
		async (encoding) => {
			const bytes =
				encoding === "utf8"
					? Buffer.from("hello 🌍\n")
					: Buffer.from([0, 1, 127, 128, 254, 255]);
			const path = `${base}/encoded.bin`;
			await fs.writeFile(path, bytes.toString(encoding), { encoding });
			expect(Buffer.from(await fs.readFileBuffer(path))).toEqual(bytes);
			expect(await fs.readFile(path, encoding)).toBe(bytes.toString(encoding));
			expect((await fs.stat(path)).size).toBe(bytes.length);
		},
	);

	it("appends to missing and existing files without corrupting bytes", async () => {
		const path = `${base}/append.bin`;
		await fs.appendFile(path, "00ff", "hex");
		await fs.appendFile(path, new Uint8Array([128, 1]));
		expect(await fs.readFile(path, "hex")).toBe("00ff8001");
		await fs.writeFile(path, "replacement");
		expect(await fs.readFile(path)).toBe("replacement");
	});

	it("recursively copies and moves a directory, preserving sibling paths", async () => {
		await fs.writeFile(`${base}/src/a.txt`, "a");
		await fs.writeFile(`${base}/src/nested/b.txt`, "b");
		await fs.writeFile(`${base}/src-other/keep.txt`, "keep");
		await expect(fs.cp(`${base}/src`, `${base}/copy`)).rejects.toThrow(
			"EISDIR",
		);
		expect(await fs.exists(`${base}/copy`)).toBe(false);
		await fs.cp(`${base}/src`, `${base}/copy`, { recursive: true });
		await fs.writeFile(`${base}/copy/a.txt`, "changed copy");
		expect(await fs.readFile(`${base}/src/a.txt`)).toBe("a");
		await fs.mv(`${base}/copy`, `${base}/moved`);
		expect(await fs.exists(`${base}/copy`)).toBe(false);
		expect(await fs.readFile(`${base}/moved/nested/b.txt`)).toBe("b");
		await expect(fs.rm(`${base}/moved`)).rejects.toThrow("EISDIR");
		await fs.rm(`${base}/moved`, { recursive: true });
		expect(await fs.exists(`${base}/moved`)).toBe(false);
		expect(await fs.readFile(`${base}/src-other/keep.txt`)).toBe("keep");
	});

	it.each(["keep.txt", "nested/../keep.txt"])(
		"rejects a move onto the same file via %s without deleting it",
		async (destination) => {
			const path = `${base}/keep.txt`;
			await fs.writeFile(path, "irreplaceable");
			await expect(fs.mv(path, `${base}/${destination}`)).rejects.toThrow(
				"EINVAL",
			);
			expect(await fs.readFile(path)).toBe("irreplaceable");
		},
	);

	it("rejects moving a directory inside itself before changing files", async () => {
		await fs.writeFile(`${base}/src/keep.txt`, "keep");
		await expect(fs.mv(`${base}/src`, `${base}/src/child`)).rejects.toThrow();
		expect(await fs.readFile(`${base}/src/keep.txt`)).toBe("keep");
		expect(await fs.exists(`${base}/src/child`)).toBe(false);
	});

	it("refuses to mount another user's chat files even when its id is known", async () => {
		await fs.writeFile(`${base}/secret.txt`, "private");
		const unauthorized = new FilesystemService({ user: other.user, chat });
		await unauthorized.fetch();
		expect(await unauthorized.exists(`${base}/secret.txt`)).toBe(false);
		await expect(unauthorized.readFile(`${base}/secret.txt`)).rejects.toThrow(
			"ENOENT",
		);
	});

	it("checks a move's source permissions before copying a read-only upload", async () => {
		const data = new FormData();
		data.set("kind", "ATTACHMENT");
		data.set("file", new File(["original"], "source.txt"));
		const upload = await api.upload.createUpload.mutate(data);
		fs = new FilesystemService({ user, chat, uploads: [upload.id] });
		await fs.fetch();
		const src = `/mnt/uploads/${upload.id}/source.txt`;
		await expect(fs.mv(src, `${base}/destination.txt`)).rejects.toThrow(
			"EROFS",
		);
		expect(await fs.readFile(src)).toBe("original");
		expect(await fs.exists(`${base}/destination.txt`)).toBe(false);
	});

	it("clones mounted metadata independently and addresses the same persisted content under a new root", async () => {
		await fs.writeFile(`${base}/nested/file.txt`, "content");
		const clone = fs.clone("/virtual");
		expect(await clone.readFile(`/virtual/chat/${chat}/nested/file.txt`)).toBe(
			"content",
		);
		expect(clone.getAllNodes()).not.toBe(fs.getAllNodes());
		expect(clone.getAllNodes()[0]).not.toBe(fs.getAllNodes()[0]);
		expect(fs.getAllPaths()).toContain(`${base}/nested/file.txt`);
		expect(clone.getAllPaths()).not.toContain(`${base}/nested/file.txt`);
		expect(await fs.exists("/mnt-other/chat/file")).toBe(false);
		await expect(fs.rm(`${base}/absent`)).rejects.toThrow("ENOENT");
		await expect(
			fs.rm(`${base}/absent`, { force: true }),
		).resolves.toBeUndefined();
	});
});
