import type {
	EmbeddingModelV4,
	LanguageModelV4,
	LanguageModelV4CallOptions,
	LanguageModelV4StreamPart,
	LanguageModelV4ToolResultPart,
	ProviderV4,
} from "@ai-sdk/provider";
import type { z } from "zod";
import type { ModelProvider } from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";
import type { spawn_subagent } from "#core/features/tool/tools/subagents/spawn_subagent.ts";

export const TestProvider: ModelProvider<ProviderV4> = {
	name: "test",
	type: "model",
	settings: [],

	getSdk() {
		return createTestProvider();
	},

	getLanguageModel({ user, model, env }) {
		return this.getSdk({ user, model, env })?.languageModel(model) ?? null;
	},

	getEmbeddingModel({ user, model, env }) {
		return this.getSdk({ user, model, env })?.embeddingModel(model) ?? null;
	},

	getSdkOptions() {
		return {};
	},

	async getStatus() {
		return {
			valid: true,
			models: [
				{
					name: "test-generate",
					features: ["language", "language:tools"],
					args: this.getModelArgs({ model: "test-generate" }),
				},
				{
					name: "test-embed",
					features: ["embedding"],
					args: this.getModelArgs({ model: "test-embed" }),
				},
			],
		};
	},

	getModelArgs() {
		return ModelProviderUtils.getModelArgs({ maxTemp: -1 });
	},
};

interface Bench {
	kind: "text" | "code" | "table" | "tools" | "tasks" | "thought" | "mixed";
	count: number;
	delay: number;
}

const BENCH_RE =
	/%bench(?:\s+(text|code|table|tools|tasks|thought|mixed))?(?:\s+(\d+))?(?:\s*~(\d+))?/i;

const SUB_RE = /%sub/;

async function emitText(
	controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
	text: string,
	sleep?: () => Promise<unknown>,
) {
	const id = `t${Math.random().toString(36).slice(2, 8)}`;
	controller.enqueue({ type: "text-start", id, providerMetadata: {} });

	// One delta per whitespace-delimited token, preserving separators.
	const tokens = text.match(/\s+|\S+/g) ?? [];
	for (const token of tokens) {
		controller.enqueue({
			type: "text-delta",
			id,
			delta: token,
			providerMetadata: {},
		});
		if (sleep) await sleep();
	}

	controller.enqueue({ type: "text-end", id, providerMetadata: {} });
}

async function emitToolCall(
	controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
	name: string,
	args: unknown,
	sleep?: () => Promise<unknown>,
) {
	const input = JSON.stringify(args);
	const id = `t${Math.random().toString(36).slice(2, 8)}`;

	controller.enqueue({
		type: "tool-input-start",
		id,
		toolName: name,
		providerMetadata: {},
	});
	for (const ch of input) {
		controller.enqueue({
			type: "tool-input-delta",
			id,
			delta: ch,
			providerMetadata: {},
		});
		if (sleep) await sleep();
	}
	controller.enqueue({ type: "tool-input-end", id, providerMetadata: {} });
	controller.enqueue({
		type: "tool-call",
		toolCallId: id,
		toolName: name,
		input,
	});
}

function get<T>(prompt: unknown, test: (text: string) => T | null): T | null {
	// Walk backwards for the most recent user text part.
	const messages = prompt as {
		role: string;
		content: string | { type: string; text?: string }[];
	}[];

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "user") continue;

		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((p) => p.type === "text")
						.map((p) => p.text ?? "")
						.join("\n");

		const result = test(text);
		if (result !== null) {
			return result;
		}
	}

	return null;
}

function getBench(prompt: unknown): Bench | null {
	return get(prompt, (text) => {
		const match = BENCH_RE.exec(text.replace(/\\/g, ""));
		if (!match) return null;

		return {
			kind: (match[1] as Bench["kind"]) ?? "text",
			count: match[2] ? Number(match[2]) : 400,
			delay: match[3] !== undefined ? Number(match[3]) : 10,
		};
	});
}

function getSub(prompt: unknown): boolean {
	return (
		get(prompt, (text) => {
			const match = SUB_RE.exec(text);
			if (!match) return null;
			return true;
		}) === true
	);
}

const WORDS =
	`the quick brown fox jumps over a lazy dog while streaming tokens through the renderer pipeline and forcing a full markdown reparse on every single frame which is exactly what we want to measure here because incremental parsing is the difference between a smooth sixty frames per second and a janky slideshow when responses grow long`.split(
		" ",
	);

/** Deterministic markdown body of roughly `count` words. */
function buildMarkdown(kind: Bench["kind"], count: number): string {
	const out: string[] = [];
	let used = 0;
	let block = 0;

	while (used < count) {
		block++;
		if (kind === "code" && block % 2 === 0) {
			const lines: string[] = [];
			for (let i = 0; i < 12; i++) {
				lines.push(
					`  const value${i} = compute(${i}, "${WORDS[(used + i) % WORDS.length]}");`,
				);
				used += 6;
			}
			out.push(
				`\`\`\`ts\nfunction block${block}() {\n${lines.join("\n")}\n}\n\`\`\``,
			);
			continue;
		}

		if (kind === "table" && block % 2 === 0) {
			const rows: string[] = [
				"| id | name | status | notes |",
				"| --- | --- | --- | --- |",
			];
			for (let i = 0; i < 10; i++) {
				rows.push(
					`| ${i} | ${WORDS[(used + i) % WORDS.length]} | ok | ${WORDS[(used + i + 3) % WORDS.length]} |`,
				);
				used += 8;
			}
			out.push(rows.join("\n"));
			continue;
		}

		if (block % 4 === 1) {
			out.push(`## Section ${block}`);
			used += 2;
			continue;
		}

		if (block % 4 === 3) {
			const items: string[] = [];
			for (let i = 0; i < 5; i++) {
				const words = Array.from(
					{ length: 8 },
					(_, j) => WORDS[(used + i * 8 + j) % WORDS.length],
				);
				items.push(`- **${words[0]}** ${words.slice(1).join(" ")}`);
				used += 8;
			}
			out.push(items.join("\n"));
			continue;
		}

		const words = Array.from(
			{ length: 40 },
			(_, j) => WORDS[(used + j) % WORDS.length],
		);
		out.push(
			`${words.join(" ")}. Inline \`code\`, a [link](https://example.com), and *emphasis*.`,
		);
		used += 40;
	}

	return out.join("\n\n");
}

async function runBench({
	options,
	controller,
	bench,
	sleep,
	toolResult,
}: {
	options: LanguageModelV4CallOptions;
	controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
	bench: Bench;
	sleep: (ms: number) => Promise<unknown>;
	toolResult?: LanguageModelV4ToolResultPart;
}) {
	const { kind, count, delay } = bench;
	console.log("[TestProvider] bench", bench);

	const emitThought = async (words: number) => {
		const id = `r${Math.random().toString(36).slice(2, 8)}`;
		controller.enqueue({ type: "reasoning-start", id, providerMetadata: {} });
		for (let i = 0; i < words; i++) {
			controller.enqueue({
				type: "reasoning-delta",
				id,
				delta: `${WORDS[i % WORDS.length]} `,
				providerMetadata: {},
			});
			if (delay > 0) await sleep(delay);
		}
		controller.enqueue({ type: "reasoning-end", id, providerMetadata: {} });
	};

	const _emitText = async (text: string) => {
		await emitText(
			controller,
			text,
			delay > 0 ? () => sleep(delay) : undefined,
		);
	};

	const _emitToolCall = async (n: number) => {
		const prompt = options.prompt.reduce(
			(acc, message) =>
				typeof message.content === "string"
					? acc + message.content
					: acc +
						message.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join(""),
			"",
		);
		console.log("[TestProvider] prompt:", prompt);
		const path = /<chat>(.*?)<\/chat>/i.exec(prompt)?.[1] ?? "";
		console.log("[TestProvider] path:", path);
		await emitToolCall(
			controller,
			"write_file",
			{ path: `${path}${n}.txt`, content: `Hello, world!` },
			delay > 0 ? () => sleep(delay) : undefined,
		);
		await emitToolCall(
			controller,
			"read_dir",
			{ path: `${path}` },
			delay > 0 ? () => sleep(delay) : undefined,
		);
	};

	if (kind === "tools") {
		// Each turn emits one batch; stop once results have come back.
		if (!toolResult) {
			for (let n = 0; n < count; n++) await _emitToolCall(n);
		} else {
			await emitText(controller, buildMarkdown("text", 60));
		}
		return;
	}

	// Like `tools`, with the write sent to the background: the model carries on
	// once the batch settles, and answers when the write reports in.
	if (kind === "tasks") {
		const answered = options.prompt.some(
			(message) =>
				typeof message.content !== "string" &&
				message.content.some((part) => part.type === "tool-result"),
		);
		if (!answered) {
			await emitToolCall(
				controller,
				"write_file",
				{ path: "0.txt", content: "Hello, world!", background: true },
				delay > 0 ? () => sleep(delay) : undefined,
			);
			await emitToolCall(
				controller,
				"read_dir",
				{ path: "" },
				delay > 0 ? () => sleep(delay) : undefined,
			);
		} else {
			await emitText(controller, buildMarkdown("text", 20));
		}
		return;
	}

	if (kind === "thought") {
		await emitThought(count);
		await _emitText(buildMarkdown("text", Math.max(60, count / 2)));
		return;
	}

	if (kind === "mixed") {
		if (!toolResult) {
			await emitThought(Math.round(count / 4));
			await _emitText(buildMarkdown("text", Math.round(count / 4)));
			for (let n = 0; n < 3; n++) await _emitToolCall(n);
		} else {
			await _emitText(buildMarkdown("text", Math.round(count / 2)));
		}
		return;
	}

	await _emitText(buildMarkdown(kind, count));
}

async function runSub({
	controller,
	toolResult,
}: {
	options: LanguageModelV4CallOptions;
	controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
	toolResult?: LanguageModelV4ToolResultPart;
}) {
	if (!toolResult) {
		await emitToolCall(controller, "spawn_subagent", {
			task: "Discover the concept of recursion.",
			prompt:
				"Recursively call another subagent of your own to find out what recursion is.",
		} satisfies z.infer<typeof spawn_subagent.input>);
	} else {
		await emitText(
			controller,
			`The agent returned with:\n\`\`\`json\n${JSON.stringify(toolResult.output, null, 2)}\n\`\`\``,
		);
	}
}

function createTestProvider(): ProviderV4 {
	return {
		specificationVersion: "v4",
		languageModel(modelId: string): LanguageModelV4 {
			return {
				specificationVersion: "v4",
				provider: "test",
				modelId,
				supportedUrls: {},
				doGenerate() {
					throw new Error("Only streams are supported.");
				},
				async doStream(options) {
					const stream = new ReadableStream<LanguageModelV4StreamPart>({
						async start(controller) {
							const sleep = (ms: number) =>
								new Promise((resolve) => setTimeout(resolve, ms));

							controller.enqueue({
								type: "stream-start",
								warnings: [],
							});

							const data = options.prompt.slice(-1)[0].content;
							console.log("[TestProvider] last message:", data);

							if (typeof data === "string") throw new Error("Expected object");

							const toolResult = data.find((p) => p.type === "tool-result");

							const bench = getBench(options.prompt);
							const sub = getSub(options.prompt);

							if (bench) {
								await runBench({
									options,
									controller,
									bench,
									sleep,
									toolResult,
								});
							} else if (sub) {
								await runSub({ options, controller, toolResult });
							} else {
								controller.enqueue({
									type: "text-start",
									id: "1",
									providerMetadata: {},
								});

								controller.enqueue({
									type: "text-delta",
									id: "1",
									delta: `Welcome to Tiny Chat. If you're seeing this, you're ready to start chatting! Add your first API key in Settings to get started.`,
									providerMetadata: {},
								});

								controller.enqueue({
									type: "text-end",
									id: "1",
									providerMetadata: {},
								});
								await sleep(1000);
							}

							controller.enqueue({
								type: "finish",
								finishReason: { unified: "stop", raw: "stop" },
								usage: {
									inputTokens: {
										total: 0,
										noCache: 0,
										cacheRead: 0,
										cacheWrite: 0,
									},
									outputTokens: {
										total: 0,
										text: 0,
										reasoning: 0,
									},
								},
								providerMetadata: {},
							});
							controller.close();
						},
					});

					return {
						stream,
						rawCall: { rawPrompt: options.prompt, rawSettings: {} },
					};
				},
			};
		},
		embeddingModel(modelId: string): EmbeddingModelV4 {
			return {
				specificationVersion: "v4",
				provider: "test",
				modelId,
				maxEmbeddingsPerCall: 100,
				supportsParallelCalls: true,
				async doEmbed({ values }) {
					return {
						embeddings: values.map((value) =>
							Array.from({ length: 8 }, (_, i) => (value.length + i) / 100),
						),
						warnings: [],
					};
				},
			};
		},
		imageModel() {
			throw new Error("Only language models are supported.");
		},
		rerankingModel() {
			throw new Error("Only language models are supported.");
		},
	};
}
