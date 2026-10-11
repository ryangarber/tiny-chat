import type {
	LanguageModelV4,
	LanguageModelV4CallOptions,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { z } from "zod";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { AgentService } from "#core/features/agent/services/AgentService.ts";
import type { zAgentMessage } from "#core/features/agent/types/agent.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import {
	zData,
	type zInterjectionPart,
} from "#core/features/data/types/part.ts";
import { TestProvider } from "#core/features/provider/providers/model/TestProvider.ts";
import type { ModelProvider } from "#core/features/provider/types/model.ts";
import type {
	Tool,
	ToolFeedback,
	Toolset,
} from "#core/features/tool/types/tool.ts";

/**
 * A provider can only reuse its cache of a chat when every request starts with
 * the bytes of the one before it: the tools, the instructions, every message
 * already sent, and then what the model answered with. These tests drive whole
 * chats through `AgentService.generate` — across steps, generations and turns —
 * and hold every request to that.
 */

type Request = {
	/** Tools first, then each prompt message (instructions included), as sent. */
	segments: string[];
	/** What the model streamed back, as it should be replayed to it. */
	output: { type: string; [key: string]: unknown }[];
};

/** The test provider, recording each request and the answer it streamed. */
const recording = () => {
	const requests: Request[] = [];

	const record = (
		options: LanguageModelV4CallOptions,
		stream: ReadableStream<LanguageModelV4StreamPart>,
	) => {
		const request: Request = {
			segments: [
				JSON.stringify(options.tools ?? []),
				...options.prompt.map((message) => JSON.stringify(message)),
			],
			output: [],
		};
		requests.push(request);

		const texts = new Map<string, { type: string; text: string }>();
		return stream.pipeThrough(
			new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>(
				{
					transform(part, controller) {
						if (part.type === "text-start" || part.type === "reasoning-start") {
							const value = {
								type: part.type === "text-start" ? "text" : "reasoning",
								text: "",
							};
							texts.set(part.id, value);
							request.output.push(value);
						} else if (
							part.type === "text-delta" ||
							part.type === "reasoning-delta"
						) {
							const value = texts.get(part.id);
							if (value) value.text += part.delta;
						} else if (part.type === "tool-call") {
							request.output.push({
								type: "tool-call",
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								input: JSON.parse(part.input),
							});
						}
						controller.enqueue(part);
					},
				},
			),
		);
	};

	const provider: ModelProvider<any> = {
		...TestProvider,
		getLanguageModel(options) {
			const model = TestProvider.getLanguageModel(options) as LanguageModelV4;
			return {
				...model,
				async doStream(options) {
					const result = await model.doStream(options);
					return { ...result, stream: record(options, result.stream) };
				},
			} satisfies LanguageModelV4;
		},
	};

	return { provider, requests };
};

/**
 * Every request starts with the whole of the one before it, byte for byte,
 * followed by the model's answer to it.
 */
const expectStablePrefix = (requests: Request[]) => {
	expect(requests.length).toBeGreaterThan(1);

	for (let i = 1; i < requests.length; i++) {
		const previous = requests[i - 1];
		const next = requests[i];

		const label = `request ${i} extends request ${i - 1}`;
		expect(next.segments.slice(0, previous.segments.length), label).toEqual(
			previous.segments,
		);

		// The answer comes back as the model gave it. Text it wrote may be framed
		// by other parts in the same message, but never altered.
		const answer = JSON.parse(next.segments[previous.segments.length] ?? "{}");
		expect(answer.role, label).toBe("assistant");
		const content = answer.content.map(
			({ providerOptions: _, ...part }: Record<string, unknown>) => part,
		);
		const start = content.findIndex(
			(part: unknown) =>
				JSON.stringify(part) === JSON.stringify(previous.output[0]),
		);
		expect(content.slice(start, start + previous.output.length), label).toEqual(
			previous.output,
		);
	}
};

const config = zConfig.parse({
	provider: "test",
	model: "test-generate",
	toolsets: ["files"],
	skills: [],
});

/**
 * Two tools that settle on their own after a delay, so calls made together
 * finish in a different order than they were made.
 */
const files = ({
	background = [],
	approval = [],
}: {
	background?: string[];
	approval?: string[];
} = {}): Toolset<void> => ({
	name: "files",
	instructions: "Read and write files.",
	capabilities: undefined,
	status: { valid: true },
	tools: (
		[
			["write_file", 30],
			["read_dir", 5],
		] as const
	).map(
		([name, delay]) =>
			({
				name,
				description: `Runs ${name}.`,
				input: z.object({ path: z.string() }).loose(),
				output: z.unknown(),
				capabilities: undefined,
				background: background.includes(name),
				validate: async () => ({ approval: approval.includes(name) }),
				execute: async ({ input }) => {
					await new Promise((resolve) => setTimeout(resolve, delay));
					return [{ type: "text", value: `${name} ${input.path} done` }];
				},
			}) satisfies Tool<any, void>,
	),
});

/**
 * A chat as the app keeps it: each message is saved, and read back from the
 * database before the next generation is built from it.
 */
const chat = (provider: ModelProvider<any>) => {
	const messages: zAgentMessage[] = [];
	let clock = Date.parse("2026-01-01T12:00:00Z");
	const now = () => {
		clock += 61_000;
		return CommonUtils.parsePlainDateTime(clock);
	};

	/** A JSON column round trip, as a stored message comes back. */
	const save = (data: zData): zData =>
		zData.parse(JSON.parse(JSON.stringify(data)));

	const generate = async ({
		toolset,
		reply,
		interjections,
		toolFeedback,
	}: {
		toolset: Toolset<void>;
		reply: zAgentMessage;
		interjections?: () => zInterjectionPart[];
		toolFeedback?: (_: unknown) => Promise<ToolFeedback>;
	}) => {
		// The reply generates into its own copy, as the client streams into one.
		const data = save(reply.data);
		const events = AgentService.generate({
			provider,
			capabilities: {},
			toolsets: [toolset],
			skills: [],
			data,
			metadata: [],
			env: {},
			interjections,
			toolFeedback,
			context: {
				user: { id: "test", name: "test", settings: {}, isEphemeral: true },
				chat: {
					id: "chat",
					project: null,
					incognito: false,
					temporary: false,
				},
				timezone: "America/New_York",
				interactive: true,
				messages: [
					...messages.slice(0, -1).map((message) => ({
						...message,
						data: save(message.data),
					})),
					{ ...reply, data },
				],
			},
		});
		for await (const _ of events);
		reply.data = save(data);
		expect(data.flat().filter((part) => part.type === "abort")).toEqual([]);
	};

	return {
		messages,
		/** Sends `text` and generates the reply to it. */
		send: async (
			text: string,
			options: Omit<Parameters<typeof generate>[0], "reply">,
		) => {
			messages.push({
				id: `user-${messages.length}`,
				author: "USER",
				config,
				createdAt: now(),
				data: [[{ id: CommonUtils.getRandomId(), type: "text", value: text }]],
			});
			const reply: zAgentMessage = {
				id: `model-${messages.length}`,
				author: "MODEL",
				config,
				createdAt: now(),
				data: [],
			};
			messages.push(reply);
			await generate({ ...options, reply });
			return reply;
		},
		/** Generates the last reply further, as when the user answers a call. */
		resume: (options: Omit<Parameters<typeof generate>[0], "reply">) => {
			const reply = messages.at(-1);
			if (reply?.author !== "MODEL") throw new Error("nothing to resume");
			return generate({ ...options, reply });
		},
	};
};

/**
 * Queues a message from the user for the model's second step, so it lands
 * between the first step's tool results and what the model does next.
 */
const interjecting = (text: string) => {
	let steps = 0;
	return (): zInterjectionPart[] =>
		++steps === 2
			? [
					{
						id: CommonUtils.getRandomId(),
						type: "interjection",
						value: [
							{ id: CommonUtils.getRandomId(), type: "text", value: text },
						],
					},
				]
			: [];
};

describe("AgentService prompt prefix", () => {
	it("keeps the prefix across the steps of parallel tool calls", async () => {
		const { provider, requests } = recording();
		await chat(provider).send("%bench tools 2 ~0", { toolset: files() });

		// Calls, their results, then the answer.
		expect(requests).toHaveLength(2);
		expect(
			requests[0].output.filter((part) => part.type === "tool-call"),
		).toHaveLength(4);
		expectStablePrefix(requests);
	});

	it("keeps the prefix while a background call runs and reports in", async () => {
		const { provider, requests } = recording();
		await chat(provider).send("%bench tasks ~0", {
			toolset: files({ background: ["write_file"] }),
		});

		// Calls, the answer with the write still running, then its report.
		expect(requests).toHaveLength(3);
		expect(requests.at(-1)?.segments.at(-1)).toContain("Background task");
		expectStablePrefix(requests);
	});

	it("keeps the prefix when the user interjects between steps", async () => {
		const { provider, requests } = recording();
		const { send } = chat(provider);
		await send("%bench tools 1 ~0", {
			toolset: files(),
			interjections: interjecting("Also check the other folder"),
		});

		expect(
			requests.some((request) =>
				request.segments.at(-1)?.includes("Also check the other folder"),
			),
		).toBe(true);
		expectStablePrefix(requests);
	});

	it("keeps the prefix when a call waits on the user and the reply resumes", async () => {
		const { provider, requests } = recording();
		const { send, resume } = chat(provider);
		const toolset = files({ approval: ["write_file"] });

		// Nobody answers, so the reply stops with the write unsettled.
		await send("%bench tools 1 ~0", { toolset });
		expect(requests).toHaveLength(1);

		await resume({ toolset, toolFeedback: async () => ({ approved: true }) });
		expect(requests).toHaveLength(2);
		expectStablePrefix(requests);
	});

	it("keeps a reply that used tools the same on the next turn", async () => {
		const { provider, requests } = recording();
		const { send } = chat(provider);

		await send("%bench tools 1 ~0", { toolset: files() });
		await send("Thanks!", { toolset: files() });

		expectStablePrefix(requests);
	});

	it("keeps a reply with several tool steps the same on the next turn", async () => {
		const { provider, requests } = recording();
		const { send } = chat(provider);

		// The interjection gets the model to call tools a second time.
		await send("%bench tools 1 ~0", {
			toolset: files(),
			interjections: interjecting("Do it again"),
		});
		expect(
			requests.filter((request) =>
				request.output.some((part) => part.type === "tool-call"),
			),
		).toHaveLength(2);
		await send("Thanks!", { toolset: files() });

		expectStablePrefix(requests);
	});

	it("keeps the prefix across turns of a complex chat", async () => {
		const { provider, requests } = recording();
		const { send, resume, messages } = chat(provider);

		await send("%bench tasks ~0", {
			toolset: files({ background: ["write_file"] }),
		});
		await send("%bench tools 2 ~0", {
			toolset: files(),
			interjections: interjecting("Make it quick"),
		});
		const toolset = files({ approval: ["write_file"] });
		await send("%bench tools 1 ~0", { toolset });
		await resume({ toolset, toolFeedback: async () => ({ approved: true }) });
		await send("%bench mixed 8 ~0", { toolset: files() });
		await send("Thanks!", { toolset: files() });

		expect(messages).toHaveLength(10);
		expectStablePrefix(requests);
	});
});
