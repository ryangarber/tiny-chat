import type { DistributiveOmit } from "#core/core/types/common.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { AgentMessagesService } from "#core/features/agent/services/AgentMessagesService.ts";
import type { zAgentMessage } from "#core/features/agent/types/agent.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

type zAgentMessageNoPartIds = Omit<zAgentMessage, "data"> & {
	data: (DistributiveOmit<zAgentMessage["data"][number][number], "id"> & {
		id?: string;
	})[][];
};
function noPartIds(message: zAgentMessageNoPartIds): zAgentMessage {
	return {
		...message,
		data: message.data.map((step) => step.map(({ id, ...rest }) => rest)),
	} as zAgentMessage;
}

const buildPlanText = async (enabledToolsets: { name: string }[] = []) => {
	const { messages } = await AgentMessagesService.buildMessages({
		enabledToolsets,
		context: {
			user: { id: "u", name: "u", settings: {}, isEphemeral: true },
			chat: { id: "c1", project: null, incognito: true, temporary: false },
			timezone: "UTC",
			interactive: true,
			messages: [
				{
					id: null,
					author: "USER",
					config: null,
					createdAt: null,
					data: [
						[
							{ id: "a", type: "command", name: "plan", value: "plan" },
							{ id: "b", type: "text", value: "Tidy the garden" },
							{
								id: "c",
								type: "quote",
								source: "/mnt/chat/c1/plan.md",
								text: "Weed the beds",
							},
						],
					],
				},
			],
		},
		capabilities: {},
	});
	return messages[0].data
		.flat()
		.map((part) => (part.type === "text" ? part.value : ""))
		.join("\n");
};

describe("AgentMessagesService", () => {
	it("puts a plan in the context of the message that asked for it", async () => {
		const text = await buildPlanText();
		expect(text).toContain('<context>\n<plan path="/mnt/chat/c1/plan.md">');
		expect(text).toContain("`plan`");
		// Without the file tools, `plan` is the only way to reach the file.
		expect(text).toContain("no other tool can reach this file");
		expect(text).toContain(
			'<quote source="/mnt/chat/c1/plan.md">\nWeed the beds\n</quote>',
		);
		// The command is read as the context it adds, not as text.
		expect(text).not.toMatch(/(^|\s)\/plan\b/m);
	});

	it("lets the file tools reach the plan when they are on", async () => {
		const text = await buildPlanText([{ name: "shell" }]);
		expect(text).toContain("`plan`");
		expect(text).not.toContain("no other tool can reach this file");
	});

	it("builds model parts from a stored attachment without reading it again", () => {
		const parts = AgentMessagesService.buildAttachmentParts({
			id: "attachment-1",
			type: "attachment",
			source: "/project/src",
			label: "src",
			content: {
				type: "directory",
				items: [
					{ path: "/project/src/index.ts" },
					{ path: "/project/src/components", directory: true },
				],
			},
		});

		expect(parts).toEqual([
			expect.objectContaining({
				type: "text",
				value: '<attachment source="/project/src" name="src">',
			}),
			expect.objectContaining({
				id: "attachment-1",
				type: "text",
				value: expect.stringContaining(
					'<file name="index.ts" path="/project/src/index.ts" />',
				),
			}),
			expect.objectContaining({ type: "text", value: "</attachment>" }),
		]);
	});

	it("builds a message tree from context", () => {
		const config = zConfig.parse({
			provider: "openai",
			model: "gpt-5",
			args: {},
			toolsets: [],
			skills: [],
		});

		const context: zAgentMessage[] = [
			{
				id: "1",
				author: "USER",
				config,
				data: [
					[{ id: CommonUtils.getRandomId(), type: "text", value: "Hello" }],
				],
				createdAt: CommonUtils.parsePlainDateTime("2026-01-01T00:00:00Z"),
			},
			{
				id: "2",
				author: "MODEL",
				config,
				data: [
					[{ id: CommonUtils.getRandomId(), type: "text", value: "Hi there" }],
				],
				createdAt: CommonUtils.parsePlainDateTime("2026-01-01T00:00:01Z"),
			},
			{
				id: "3",
				author: "USER",
				config,
				data: [
					[
						{
							id: CommonUtils.getRandomId(),
							type: "text",
							value: "Hello again",
						},
					],
				],
				createdAt: CommonUtils.parsePlainDateTime("2026-01-01T00:15:01Z"),
			},
		];

		const builtContext = context.map((message, i, array) =>
			AgentMessagesService.buildMessageBlock({
				message,
				previous: array[i - 1],
				data: message.data,
				timezone: "America/New_York",
			}),
		);

		expect(noPartIds(builtContext[0])).toEqual(
			noPartIds({
				...context[0],
				data: [
					[
						{
							type: "text",
							value: `<message role="user" to="gpt-5" sent="${CommonUtils.formatDate({ date: context[0].createdAt ?? undefined, timezone: "America/New_York" })}">`,
						},
						...context[0].data.flat(),
						{ type: "text", value: "</message>" },
					],
				],
			} satisfies zAgentMessageNoPartIds),
		);

		// A reply goes out as the model wrote it, steps and all.
		expect(builtContext[1]).toEqual(context[1]);

		expect(noPartIds(builtContext[2])).toEqual(
			noPartIds({
				...context[2],
				data: [
					[
						{
							type: "text",
							value: `<message role="user" to="gpt-5" sent="${CommonUtils.formatDate({ date: context[2].createdAt ?? undefined, timezone: "America/New_York" })}" gap="15 minutes">`,
						},
						...context[2].data.flat(),
						{ type: "text", value: "</message>" },
					],
				],
			} satisfies zAgentMessageNoPartIds),
		);
	});

	it("builds a file tree from a directory", () => {
		const tree = FileUtils.toTree({
			nodes: [
				{
					path: ["README.md"],
					uri: "/mnt/uploads/UPLOAD_ID/README.md",
				},
				{
					path: ["src", "gen", "lib", "main.so"],
					uri: "/mnt/uploads/UPLOAD_ID/src/gen/lib/main.so",
				},
			],
		});

		expect(
			AgentMessagesService.buildTree({
				tree,
				depth: 1,
			}),
		).toEqual(
			`  <file name="README.md" path="${PathUtils.toMount({ mount: "uploads", id: "UPLOAD_ID", path: ["README.md"] })}" />
  <folder name="src">
    <folder name="gen" />
  </folder>`,
		);

		expect(
			AgentMessagesService.buildTree({
				tree,
				depth: 1,
				maxDepth: 4,
			}),
		).toEqual(
			`  <file name="README.md" path="${PathUtils.toMount({ mount: "uploads", id: "UPLOAD_ID", path: ["README.md"] })}" />
  <folder name="src">
    <folder name="gen">
      <folder name="lib">
        <file name="main.so" path="${PathUtils.toMount({ mount: "uploads", id: "UPLOAD_ID", path: ["src", "gen", "lib", "main.so"] })}" />
      </folder>
    </folder>
  </folder>`,
		);
	});
});
