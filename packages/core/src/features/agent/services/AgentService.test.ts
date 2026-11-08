import { z } from "zod";
import { AgentService } from "#core/features/agent/services/AgentService.ts";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import { zConfig } from "#core/features/data/types/message.ts";
import type {
	zData,
	zDataSimplePart,
	zInterjectionPart,
	zToolCallPart,
} from "#core/features/data/types/part.ts";
import { FileChangeService } from "#core/features/file/services/FileChangeService.ts";
import { TestProvider } from "#core/features/provider/providers/model/TestProvider.ts";
import { ModelProviderService } from "#core/features/provider/services/ModelProviderService.ts";
import type {
	Tool,
	ToolFeedback,
	Toolset,
} from "#core/features/tool/types/tool.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";

/** A write and a read of `path`, made together. */
const calls = ({ path = "", background = false } = {}) => [
	{
		tool: "edit_files",
		input: {
			steps: [{ action: "write", path: `${path}0.txt`, content: "Hello!" }],
			...(background ? { background } : {}),
		},
	},
	{ tool: "read_files", input: { reads: [{ path }] } },
];

/** Scripts for the test model: see `TestProvider`. */
const script = {
	text: JSON.stringify(["Hello there."]),
	/** The calls, then an answer once their results are in. */
	tools: ({ path = "", delay = 10 } = {}) =>
		JSON.stringify([
			...calls({ path }).map((call) => ({ ...call, delay })),
			{ text: "Done.", delay },
		]),
	/** The calls with the write in the background, answered as it runs and once it reports. */
	tasks: JSON.stringify([
		calls({ background: true }),
		[{ text: "Carrying on meanwhile.", delay: 0 }],
		[{ text: "The write is done.", delay: 0 }],
	]),
};

describe("AgentService", () => {
	for (const tools of [false, true])
		it(
			tools
				? "consumes queued messages at the next tool loop"
				: "leaves late messages unconsumed when generation ends",
			async () => {
				const data: zData = [];
				const queued: zInterjectionPart[] = [];
				const config = zConfig.parse({
					provider: "test",
					model: "test-generate",
					toolsets: [],
				});
				let calls = 0;
				let sent = false;
				const run = AgentService.generate({
					provider: TestProvider,
					capabilities: {},
					toolsets: [],
					skills: [],
					data,
					metadata: [],
					env: {},
					instructions: "Test",
					context: {
						user: { id: "test", name: "test", settings: {}, isEphemeral: true },
						timezone: "UTC",
						interactive: true,
						messages: [
							{
								id: "prompt",
								author: "USER",
								config,
								createdAt: null,
								data: [
									[
										{
											id: "prompt",
											type: "text",
											value: tools ? script.tools() : script.text,
										},
									],
								],
							},
							{ id: "reply", author: "MODEL", config, createdAt: null, data },
						],
					},
					interjections: () => {
						calls++;
						return queued.splice(0);
					},
				});
				for await (const event of run) {
					if (event.type === "data" && !sent) {
						queued.push({
							id: "queued",
							type: "interjection",
							value: [
								{ id: "content", type: "text", value: "Please continue" },
							],
						});
						sent = true;
					}
				}
				expect(data.flat().filter((part) => part.type === "abort")).toEqual([]);
				if (tools) expect(calls).toBeGreaterThanOrEqual(2);
				else expect(calls).toBe(1);
				expect(data.flat().some((part) => part.type === "interjection")).toBe(
					tools,
				);
				expect(queued).toHaveLength(tools ? 0 : 1);
			},
		);

	const run = (prompt: string, abortSignal?: AbortSignal) => {
		const data: zData = [];
		const config = zConfig.parse({
			provider: "test",
			model: "test-generate",
			toolsets: [],
		});
		return {
			data,
			events: AgentService.generate({
				provider: TestProvider,
				capabilities: {},
				toolsets: [],
				skills: [],
				data,
				metadata: [],
				env: {},
				instructions: "<chat>/mnt/chat/123/</chat>",
				options: { abortSignal },
				context: {
					user: { id: "test", name: "test", settings: {}, isEphemeral: true },
					timezone: "UTC",
					interactive: true,
					messages: [
						{
							id: "prompt",
							author: "USER",
							config,
							createdAt: null,
							data: [[{ id: "prompt", type: "text", value: prompt }]],
						},
						{ id: "reply", author: "MODEL", config, createdAt: null, data },
					],
				},
			}),
		};
	};

	it("streams a tool call's input before the call is complete", async () => {
		// Paced like a real model, so the input is parsed between tokens.
		const { data, events } = run(
			script.tools({ path: "/mnt/chat/123/", delay: 5 }),
		);
		const seen: unknown[] = [];
		for await (const event of events) {
			if (event.type !== "toolInput") continue;
			const part = data.flat().find((part) => part.type === "toolCall");
			if (part?.type === "toolCall" && part.partial) seen.push(part.input);
		}

		// The input is readable while it is still being written: the file's
		// path, as the first call (a write) or the second (a read) has it.
		type Input = {
			reads?: { path?: string }[];
			steps?: { path?: string }[];
		};
		const pathOf = (input: unknown) =>
			(input as Input).reads?.[0]?.path ?? (input as Input).steps?.[0]?.path;
		expect(seen.length).toBeGreaterThan(1);
		expect(seen.some((input) => !!pathOf(input))).toBe(true);
		for (const input of seen) {
			const path = pathOf(input);
			if (path !== undefined)
				expect("/mnt/chat/123/").toContain(
					path.slice(0, "/mnt/chat/123/".length),
				);
		}

		// It settles into one complete call, in the place it streamed into.
		const calls = data
			.flat()
			.filter(
				(part): part is zToolCallPart =>
					part.type === "toolCall" && part.name === "read_files",
			);
		expect(calls).toHaveLength(1);
		expect(calls[0]).not.toHaveProperty("partial");
		expect(calls[0].input).toEqual({ reads: [{ path: "/mnt/chat/123/" }] });
	});

	it("drops a tool call the model never finished writing", async () => {
		const abort = new AbortController();
		const { data, events } = run(
			script.tools({ path: "/mnt/chat/123/", delay: 5 }),
			abort.signal,
		);
		let started = false;
		for await (const event of events) {
			if (event.type === "toolInput" && event.delta && !started) {
				started = true;
				abort.abort();
			}
		}

		expect(started).toBe(true);
		expect(data.flat().filter((part) => part.type === "toolCall")).toEqual([]);
		expect(data.flat().some((part) => part.type === "abort")).toBe(true);
	});

	describe("interrupting a tool call", () => {
		/** The calls the test model makes, never settling or looking at a signal. */
		const hang = () => {
			let started = 0;
			const tools = ["edit_files", "read_files"].map(
				(name) =>
					({
						name,
						description: "",
						input: z.object({ path: z.string() }).loose(),
						output: z.unknown(),
						capabilities: undefined,
						execute: () => {
							started++;
							return new Promise(() => {});
						},
					}) satisfies Tool<any, void>,
			);
			const toolset: Toolset<void> = {
				name: "hang",
				tools,
				capabilities: undefined,
				status: { valid: true },
			};
			return { toolset, started: () => started };
		};

		const generate = (toolset: Toolset<void>, abort: AbortController) => {
			const data: zData = [];
			const config = zConfig.parse({
				provider: "test",
				model: "test-generate",
				toolsets: ["hang"],
			});
			return {
				data,
				events: AgentService.generate({
					provider: TestProvider,
					capabilities: {},
					toolsets: [toolset],
					skills: [],
					data,
					metadata: [],
					env: {},
					instructions: "Test",
					toolSignal: () => abort.signal,
					context: {
						user: { id: "test", name: "test", settings: {}, isEphemeral: true },
						timezone: "UTC",
						interactive: true,
						messages: [
							{
								id: "prompt",
								author: "USER",
								config,
								createdAt: null,
								data: [
									[
										{
											id: "prompt",
											type: "text",
											value: script.tools({ delay: 0 }),
										},
									],
								],
							},
							{ id: "reply", author: "MODEL", config, createdAt: null, data },
						],
					},
				}),
			};
		};

		it("lets go of hung calls and waits for the user", async () => {
			const { toolset, started } = hang();
			const abort = new AbortController();
			const { data, events } = generate(toolset, abort);

			const timer = setInterval(() => {
				if (started()) abort.abort();
			}, 10);
			for await (const _ of events);
			clearInterval(timer);

			// Both calls run together, so both are started and both let go of.
			const results = data.flat().filter((part) => part.type === "toolResult");
			expect(started()).toBe(2);
			expect(results).toHaveLength(2);
			for (const result of results) {
				expect(result.error).toBe(true);
				expect(ToolCallUtils.isInterruption(result.output)).toBe(true);
			}
			// The model is not asked to go on: no text follows the results.
			expect(data.at(-1)?.some((part) => part.type === "toolResult")).toBe(
				true,
			);
			expect(data.flat().some((part) => part.type === "abort")).toBe(false);
		});
	});

	describe("running tool calls", () => {
		/** A call that settles when `release` is called with its name. */
		const gated = (options: {
			sequential?: string[];
			background?: string[];
			approval?: string[];
		}) => {
			const log: string[] = [];
			const gates = new Map<string, () => void>();
			const tools = ["edit_files", "read_files"].map(
				(name) =>
					({
						name,
						description: "",
						input: z.object({ path: z.string() }).loose(),
						output: z.unknown(),
						capabilities: undefined,
						sequential: options.sequential?.includes(name),
						background: options.background?.includes(name),
						validate: async () => ({
							approval: options.approval?.includes(name),
						}),
						execute: ({ abort }) => {
							log.push(`start ${name}`);
							return new Promise((resolve, reject) => {
								abort?.addEventListener("abort", () => reject(abort.reason));
								gates.set(name, () => {
									log.push(`end ${name}`);
									resolve([{ type: "text", value: `${name} done` }]);
								});
							});
						},
					}) satisfies Tool<any, void>,
			);
			const toolset: Toolset<void> = {
				name: "gated",
				tools,
				capabilities: undefined,
				status: { valid: true },
			};
			/** Settles `name` once it has started. */
			const release = async (name: string) => {
				while (!gates.has(name)) await new Promise((r) => setTimeout(r, 5));
				gates.get(name)?.();
			};
			return { toolset, log, release };
		};

		const generate = (
			prompt: string,
			toolset: Toolset<void>,
			abortSignal?: AbortSignal,
			{
				toolFeedback,
				data = [],
			}: {
				toolFeedback?: Parameters<
					typeof AgentService.generate
				>[0]["toolFeedback"];
				data?: zData;
			} = {},
		) => {
			const config = zConfig.parse({
				provider: "test",
				model: "test-generate",
				toolsets: ["gated"],
			});
			return {
				data,
				events: AgentService.generate({
					provider: TestProvider,
					capabilities: {},
					toolsets: [toolset],
					skills: [],
					data,
					metadata: [],
					env: {},
					instructions: "Test",
					options: { abortSignal },
					toolFeedback,
					context: {
						user: { id: "test", name: "test", settings: {}, isEphemeral: true },
						timezone: "UTC",
						interactive: true,
						messages: [
							{
								id: "prompt",
								author: "USER",
								config,
								createdAt: null,
								data: [[{ id: "prompt", type: "text", value: prompt }]],
							},
							{ id: "reply", author: "MODEL", config, createdAt: null, data },
						],
					},
				}),
			};
		};

		const drain = async (events: AsyncIterable<unknown>) => {
			for await (const _ of events);
		};

		it("runs calls made together at the same time", async () => {
			const { toolset, log, release } = gated({});
			const { data, events } = generate(script.tools(), toolset);
			const done = drain(events);

			// The second finishes first, which it only can if both are running.
			await release("read_files");
			await release("edit_files");
			await done;

			expect(log).toEqual([
				"start edit_files",
				"start read_files",
				"end read_files",
				"end edit_files",
			]);
			// Results are put back in the order of the calls.
			const step = data.find((parts) =>
				parts.some((part) => part.type === "toolCall"),
			);
			expect(
				step
					?.filter(
						(part) => part.type === "toolCall" || part.type === "toolResult",
					)
					.map((part) => `${part.type} ${"name" in part ? part.name : ""}`),
			).toEqual([
				"toolCall edit_files",
				"toolCall read_files",
				"toolResult edit_files",
				"toolResult read_files",
			]);
		});

		it("runs a sequential call alone", async () => {
			const { toolset, log, release } = gated({ sequential: ["edit_files"] });
			const { events } = generate(script.tools(), toolset);
			const done = drain(events);

			await release("edit_files");
			await release("read_files");
			await done;

			expect(log).toEqual([
				"start edit_files",
				"end edit_files",
				"start read_files",
				"end read_files",
			]);
		});

		it("carries on while a background call runs, then reports it", async () => {
			const { toolset, log, release } = gated({ background: ["edit_files"] });
			const { data, events } = generate(script.tasks, toolset);
			const done = drain(events);

			// The model gets past the batch with the write still running.
			await release("read_files");
			while (!data.flat().some((part) => part.type === "text" && !!part.value))
				await new Promise((r) => setTimeout(r, 5));
			expect(log).toEqual([
				"start edit_files",
				"start read_files",
				"end read_files",
			]);

			// The generation waits for it rather than ending.
			let ended = false;
			void done.then(() => {
				ended = true;
			});
			await new Promise((r) => setTimeout(r, 50));
			expect(ended).toBe(false);

			await release("edit_files");
			await done;

			const parts = data.flat();
			const placeholder = parts.find(
				(part) => part.type === "toolResult" && part.name === "edit_files",
			);
			expect(
				placeholder?.type === "toolResult" &&
					ToolCallUtils.isBackground(placeholder.output),
			).toBe(true);
			const report = parts.find(
				(part): part is zInterjectionPart =>
					part.type === "interjection" && !!part.task,
			);
			expect(report?.task?.name).toBe("edit_files");
			expect(report?.value).toMatchObject([
				{ type: "text", value: "edit_files done" },
			]);
			// The model answers once more, after it has been told.
			expect(parts.at(-1)?.type).toBe("text");
			// biome-ignore lint/complexity/useIndexOf: types don't match
			expect(parts.findIndex((part) => part === report)).toBeLessThan(
				parts.length - 1,
			);
		});

		it("stops background calls with the generation", async () => {
			const { toolset, release } = gated({ background: ["edit_files"] });
			const abort = new AbortController();
			const { data, events } = generate(script.tasks, toolset, abort.signal);
			const done = drain(events);

			await release("read_files");
			while (!data.flat().some((part) => part.type === "text"))
				await new Promise((r) => setTimeout(r, 5));
			abort.abort();
			await done;

			const report = data
				.flat()
				.find(
					(part): part is zInterjectionPart =>
						part.type === "interjection" && !!part.task,
				);
			expect(report?.task?.error).toBe(true);
			expect(ToolCallUtils.isInterruption(report?.value ?? [])).toBe(true);
		});

		describe("answering a call", () => {
			/** Answers the generation waits on, given by the test. */
			const answering = () => {
				const waits = new Map<
					string,
					{ resolve: (answer: ToolFeedback) => void; signal: AbortSignal }
				>();
				const toolFeedback = ({
					part,
					signal,
				}: {
					part: zToolCallPart;
					signal: AbortSignal;
				}) =>
					new Promise<ToolFeedback>((resolve, reject) => {
						waits.set(part.name, { resolve, signal });
						signal.addEventListener("abort", () => reject(signal.reason));
					});
				const answer = async (name: string, answer: ToolFeedback) => {
					while (!waits.has(name)) await new Promise((r) => setTimeout(r, 5));
					waits.get(name)?.resolve(answer);
				};
				return { toolFeedback, waits, answer };
			};

			const result = (data: zData, name: string) =>
				data
					.flat()
					.find((part) => part.type === "toolResult" && part.name === name);

			it("takes an answer while another call runs, and carries on", async () => {
				const { toolset, log, release } = gated({ approval: ["edit_files"] });
				const { toolFeedback, answer } = answering();
				const { data, events } = generate(script.tools(), toolset, undefined, {
					toolFeedback,
				});
				const done = drain(events);

				// Answered with the other call still running, so it starts at once.
				await answer("edit_files", { approved: true });
				await release("edit_files");
				await release("read_files");
				await done;

				expect(log).toEqual([
					"start read_files",
					"start edit_files",
					"end edit_files",
					"end read_files",
				]);
				expect(result(data, "edit_files")).toMatchObject({
					output: [{ type: "text", value: "edit_files done" }],
				});
				// No stop for the user: the model goes on after the results.
				expect(data.flat().at(-1)?.type).toBe("text");
			});

			it("takes an answer while a background call runs", async () => {
				const { toolset, log, release } = gated({
					approval: ["read_files"],
					background: ["edit_files"],
				});
				const { toolFeedback, answer } = answering();
				const { data, events } = generate(script.tasks, toolset, undefined, {
					toolFeedback,
				});
				const done = drain(events);

				// Nothing but the background call is running, and it is not in the way.
				await answer("read_files", { approved: true });
				await release("read_files");
				while (
					!data.flat().some((part) => part.type === "text" && !!part.value)
				)
					await new Promise((r) => setTimeout(r, 5));
				expect(log).toEqual([
					"start edit_files",
					"start read_files",
					"end read_files",
				]);

				await release("edit_files");
				await done;
				expect(result(data, "read_files")).toMatchObject({
					output: [{ type: "text", value: "read_files done" }],
				});
			});

			it("rejects a call the user denies", async () => {
				const { toolset, log, release } = gated({ approval: ["edit_files"] });
				const { toolFeedback, answer } = answering();
				const { data, events } = generate(script.tools(), toolset, undefined, {
					toolFeedback,
				});
				const done = drain(events);

				await answer("edit_files", { approved: false });
				await release("read_files");
				await done;

				expect(log).toEqual(["start read_files", "end read_files"]);
				const rejected = result(data, "edit_files");
				expect(
					rejected?.type === "toolResult" &&
						ToolCallUtils.isRejection(rejected.output),
				).toBe(true);
				expect(data.flat().at(-1)?.type).toBe("text");
			});

			it("stops waiting once nothing else runs, and ends", async () => {
				const { toolset, release } = gated({ approval: ["edit_files"] });
				const { toolFeedback, waits } = answering();
				const { data, events } = generate(script.tools(), toolset, undefined, {
					toolFeedback,
				});
				const done = drain(events);

				await release("read_files");
				await done;

				expect(waits.get("edit_files")?.signal.aborted).toBe(true);
				expect(result(data, "edit_files")).toBeUndefined();
				expect(result(data, "read_files")).toBeDefined();
				expect(data.flat().at(-1)?.type).toBe("toolResult");
			});

			it("resumes with an answer given ahead, and runs the call", async () => {
				const { toolset, log, release } = gated({ approval: ["edit_files"] });
				const data: zData = [
					[
						{
							type: "toolCall",
							id: "write",
							name: "edit_files",
							input: { path: "/a" },
							validation: { approval: true },
						},
						{
							type: "toolCall",
							id: "read",
							name: "read_files",
							input: { path: "/" },
						},
						{
							type: "toolResult",
							id: "read",
							name: "read_files",
							output: [{ id: "out", type: "text", value: "read_files done" }],
						},
					],
				];
				const { events } = generate(script.tools(), toolset, undefined, {
					data,
					toolFeedback: async () => ({ approved: true }),
				});
				const done = drain(events);

				await release("edit_files");
				await done;

				expect(log).toEqual(["start edit_files", "end edit_files"]);
				// Results stay after the calls, in their order, before the reply.
				expect(
					data[0].map((part) =>
						part.type === "toolResult" ? `result ${part.id}` : part.type,
					),
				).toEqual(["toolCall", "toolCall", "result write", "result read"]);
				expect(data.flat().at(-1)?.type).toBe("text");
			});
		});
	});

	describe("changes of the provider's own calls", () => {
		afterEach(() => vi.restoreAllMocks());

		/** One step of a provider that runs its own tools, and its tracker's log. */
		const generate = (step: zAgentEvent[]) => {
			const log: string[] = [];
			vi.spyOn(FileChangeService, "createTracker").mockReturnValue({
				begin: async () => void log.push("begin"),
				cancel: () => void log.push("cancel"),
				end: async () => {
					log.push("end");
					return { files: [{ path: "/repo/a.txt", before: "a", after: "b" }] };
				},
			});
			vi.spyOn(ModelProviderService, "runLanguageModel").mockImplementation(
				async function* () {
					log.push("step");
					yield* step;
				},
			);
			const data: zData = [];
			const config = zConfig.parse({
				provider: "test",
				model: "test-generate",
				toolsets: [],
			});
			const events = AgentService.generate({
				provider: { ...TestProvider, runsTools: () => true },
				capabilities: { shell: {} as never },
				toolsets: [],
				skills: [],
				data,
				metadata: [],
				env: {},
				instructions: "Test",
				context: {
					user: { id: "test", name: "test", settings: {}, isEphemeral: true },
					timezone: "UTC",
					interactive: true,
					messages: [
						{
							id: "prompt",
							author: "USER",
							config,
							createdAt: null,
							data: [[{ id: "prompt", type: "text", value: "Go" }]],
						},
						{ id: "reply", author: "MODEL", config, createdAt: null, data },
					],
				},
			});
			return { data, events, log };
		};

		const call = (id: string, name: string): zAgentEvent => ({
			type: "data",
			value: { type: "toolCall", id, name, input: {}, providerExecuted: true },
		});
		const result = (
			id: string,
			name: string,
			output: zDataSimplePart[] = [
				{ id: `${id}:out`, type: "text", value: "done" },
			],
		): zAgentEvent => ({
			type: "data",
			value: { type: "toolResult", id, name, providerExecuted: true, output },
		});
		const start: zAgentEvent = { type: "start", warnings: [] };
		const end: zAgentEvent = {
			type: "end",
			metadata: [{ type: "finish", finishReason: "stop" }],
		};

		it("finds what a call changed, from the start of its step", async () => {
			const { data, events, log } = generate([
				start,
				call("bash", "Bash"),
				call("read", "Read"),
				result("read", "Read"),
				result("bash", "Bash"),
				end,
			]);
			for await (const _ of events);

			// The step's window is taken before it streams; `Read` isn't watched.
			expect(log).toEqual(["begin", "step", "begin", "end", "cancel"]);
			const results = data.flat().filter((part) => part.type === "toolResult");
			expect(
				results.find((part) => part.id === "bash")?.changes?.files,
			).toEqual([{ path: "/repo/a.txt", before: "a", after: "b" }]);
			expect(
				results.find((part) => part.id === "read")?.changes,
			).toBeUndefined();
		});

		it("lets go of a call asking approval, or running in the background", async () => {
			const { data, events, log } = generate([
				start,
				call("asks", "Bash"),
				{ type: "approval", id: "asks" },
				call("later", "Bash"),
				result("later", "Bash", ToolCallUtils.getBackground({ id: "later" })),
				end,
			]);
			for await (const _ of events);

			expect(log).toEqual([
				"begin",
				"step",
				"begin",
				"cancel",
				"begin",
				"cancel",
				"cancel",
			]);
			expect(
				data.flat().some((part) => part.type === "toolResult" && part.changes),
			).toBe(false);
		});
	});
});
