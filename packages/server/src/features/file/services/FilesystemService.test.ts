import type { z } from "zod";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import type { zData, zDataPart } from "#core/features/data/types/part.ts";
import { read_files } from "#core/features/tool/tools/shell/read_files.ts";
import { shell_exec } from "#core/features/tool/tools/shell/shell_exec.ts";
import { mockConfig } from "#core/tests.ts";
import { testClient } from "#server/tests.ts";

const { user, api } = testClient();

/** The attachment directive that points a message into an upload. */
const upload = async (name: string, content: string) => {
	const data = new FormData();
	data.set("kind", "ATTACHMENT");
	data.set("file", new File([content], name));
	const upload = await api.upload.createUpload.mutate(data);
	return {
		type: "attachment",
		id: upload.id,
		label: name,
		source: `/mnt/uploads/${upload.id}`,
		content: {
			type: "directory",
			items: [{ path: `/mnt/uploads/${upload.id}/${name}` }],
		},
	} satisfies zDataPart;
};

describe("FilesystemService", () => {
	let upload1: Awaited<ReturnType<typeof upload>>;
	let upload2: Awaited<ReturnType<typeof upload>>;
	let chatId: string;
	let context: zAgentContext;

	beforeAll(async () => {
		upload1 = await upload("question space.md", "Files suck. I hate files.");
		upload2 = await upload("question nbsp.md", "Files suck. I hate files.");

		// An upload is on the mount because a message points into it, so what
		// mounts these two is the attachment directives referencing them.
		const message = await api.message.createMessage.mutate({
			author: "USER",
			config: mockConfig(),
			data: [[upload1, upload2]] satisfies zData,
			metadata: [],
		});
		const chat = await api.chat.getChat.query(message);
		if (!chat) throw new Error("Test chat not found");
		chatId = chat.id;
		context = {
			user,
			chat,
			messages: [message],
			interactive: false,
			timezone: "UTC",
		};
		await api.chat.activate.mutate({ chatId: chat.id });
		await exec(`cd /mnt/chat/${chat.id}`);
	});

	const exec = async (
		command: string,
	): Promise<z.infer<typeof shell_exec.output>> => {
		const output = await api.testing.tool.mutate({
			name: shell_exec.name,
			context,
			input: { command, mnt: true } satisfies z.infer<typeof shell_exec.input>,
		});
		expect.assert(output[0].type === "json");
		console.log(`---\n$ ${command}\n`, output[0].value, "\n---");
		return output[0].value as z.infer<typeof shell_exec.output>;
	};

	it("lays the mount out as uploads, skills and chat", async () => {
		const output = await exec("ls /mnt");
		expect(output.stdout).toContain("uploads");
		expect(output.stdout).toContain("skills");
		expect(output.stdout).toContain("chat");
	});

	it("finds the upload in `ls -l`", async () => {
		const output = await exec("ls -l /mnt/uploads");
		expect(output.stdout).toContain(upload1.id);
	});

	it("finds the uploaded file in `ls -l`", async () => {
		const output = await exec(`ls -l /mnt/uploads/${upload1.id}`);
		expect(output.stdout).toContain("question space.md");
	});

	it("finds the file in `ls -l`", async () => {
		const output = await exec(`ls -l /mnt/uploads/${upload2.id}`);
		expect(output.stdout).toContain(".md");
	});

	it("resolves a path despite bad unicode", async () => {
		const output = await api.testing.tool.mutate({
			name: read_files.name,
			context,
			input: {
				reads: [{ path: `/mnt/uploads/${upload2.id}/question nbsp.md` }],
			} satisfies z.infer<typeof read_files.input>,
		});
		const file = output.find((part) => part.type === "file");
		expect.assert(file?.type === "file");
		expect(file.name).toEqual("question nbsp.md");
	});

	it("starts in the chat's own directory", async () => {
		const output = await exec("pwd");
		expect(output.stdout.trim()).toBe(`/mnt/chat/${chatId}`);
	});

	it("writes a file to the chat", async () => {
		let output = await exec('echo "Hello, world!" > hello.txt');
		expect(output.stderr.trim().length).toBe(0);
		output = await exec(`cat /mnt/chat/${chatId}/hello.txt`);
		expect(output.stdout).toContain("Hello, world!");
	});

	it("writes a file to the chat using python", async () => {
		const output = await exec(
			"python3 -c \"import os; print(os.getcwd()); f = open('python.txt', 'w'); f.write('Written by Python'); f.close()\"",
		);
		expect(output.stderr).toBe("");
		expect(output.code).toBe(0);
		expect(output.stdout.trim()).toBe(`/mnt/chat/${chatId}`);
		const written = await exec(`cat /mnt/chat/${chatId}/python.txt`);
		expect(written.stdout).toBe("Written by Python");
		// Python itself has a 30s execution limit; allow time for HTTP/DB work and
		// worker cleanup so a Python failure reaches the assertions above.
	}, 60_000);

	it("refuses to write over an upload", async () => {
		const output = await exec(
			`echo "nope" > "/mnt/uploads/${upload1.id}/${upload1.label}"`,
		);
		expect(output.stderr).toMatch(/read-only/i);

		const read = await exec(
			`cat "/mnt/uploads/${upload1.id}/${upload1.label}"`,
		);
		expect(read.stdout).toContain("Files suck. I hate files.");
	});

	it("refuses to delete an upload", async () => {
		const output = await exec(`rm -r /mnt/uploads/${upload1.id}`);
		expect(output.stderr).toMatch(/read-only/i);
		expect((await exec("ls /mnt/uploads")).stdout).toContain(upload1.id);
	});

	it("copies an upload into the chat, where it can be changed", async () => {
		const source = `/mnt/uploads/${upload2.id}/${upload2.label}`;
		const destination = `/mnt/chat/${chatId}/copied.md`;

		let output = await exec(`cp "${source}" "${destination}"`);
		expect(output.stderr.trim().length).toBe(0);

		output = await exec(`echo "changed" >> "${destination}"`);
		expect(output.stderr.trim().length).toBe(0);

		output = await exec(`cat "${destination}"`);
		expect(output.stdout).toContain("Files suck. I hate files.");
		expect(output.stdout).toContain("changed");

		// The original is untouched: there is one file per path, and the copy is
		// its own file rather than a layer over this one.
		output = await exec(`cat "${source}"`);
		expect(output.stdout).not.toContain("changed");
	});

	it("reports every file on the mount, in the tree it belongs to", async () => {
		const files = await api.file.getFiles.query({
			chat: chatId,
			uploads: [upload1.id, upload2.id],
		});

		const uploaded = files.find(
			(file) => file.mount === "uploads" && file.id === upload1.id,
		);
		expect.assert(uploaded);
		expect(uploaded.path.slice(0, 2)).toEqual(["uploads", upload1.id]);
		expect(uploaded.name).toBe(upload1.label);

		const written = files.find((file) => file.path.includes("hello.txt"));
		expect.assert(written);
		expect(written.mount).toBe("chat");
		expect(written.id).toBe(chatId);
		expect(written.lines).toBeGreaterThan(0);
	});

	it("names an upload's directory after the upload, and only there", async () => {
		const trees = await api.file.getDirectory.query({
			uploads: [upload1.id],
			path: [],
		});
		// The tree's own segment is its name already; nothing borrows from below.
		expect(trees.find((entry) => entry.name === "uploads")?.label).toBeNull();

		const uploads = await api.file.getDirectory.query({
			uploads: [upload1.id],
			path: ["uploads"],
		});
		expect(uploads.find((entry) => entry.name === upload1.id)?.label).toBe(
			upload1.label,
		);

		const files = await api.file.getDirectory.query({
			uploads: [upload1.id],
			path: ["uploads", upload1.id],
		});
		expect(
			files.find((entry) => entry.name === "question space.md")?.label,
		).toBeNull();
	});

	it("builds a mount for a message that has no chat at all", async () => {
		// The whole point of building from ids: an upload can be read before the
		// message referencing it has been sent anywhere.
		const files = await api.file.getFiles.query({ uploads: [upload1.id] });

		expect(
			files.some(
				(file) =>
					file.mount === "uploads" && file.path.includes("question space.md"),
			),
		).toBe(true);
		expect(
			files.some((file) => file.mount === "chat" && !file.isDirectory),
		).toBe(false);
	});
});
