import type {
	EmbeddingModelV4,
	LanguageModelV4,
	LanguageModelV4Prompt,
	LanguageModelV4StreamPart,
	ProviderV4,
} from "@ai-sdk/provider";
import { z } from "zod";
import type { ModelProvider } from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

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
		return ModelProviderUtils.getModelArgs({ temperature: false });
	},
};

const WELCOME =
	"Welcome to Tiny Chat. If you're seeing this, you're ready to start chatting! Add your first API key in Settings to get started.";

/** Milliseconds between streamed chunks, unless an item says otherwise. */
const DELAY = 10;

const zRepeat = z
	.number()
	.int()
	.min(1)
	.optional()
	.describe("Streams the text this many times over.");
const zDelay = z.number().min(0).optional().describe("Milliseconds per chunk.");

/**
 * One thing the test model outputs. A bare string is text.
 *
 * `[{ "thought": "Hmm" }, { "tool": "read_files", "input": { … } }, "Done"]`
 */
const zScriptItem = z.union([
	z.string(),
	z.strictObject({ text: z.string(), repeat: zRepeat, delay: zDelay }),
	z.strictObject({ thought: z.string(), repeat: zRepeat, delay: zDelay }),
	z.strictObject({
		tool: z.string(),
		input: z.unknown().optional(),
		delay: zDelay,
	}),
	z.strictObject({ wait: z.number().min(0) }),
	z.strictObject({ error: z.string() }),
]);
type zScriptItem = z.infer<typeof zScriptItem>;

/**
 * A script for the test model: items, which run up to and including each run
 * of tool calls before the model waits for their results, or steps (arrays of
 * items) for exact control over what each model call outputs.
 */
const zScript = z.union([
	z.array(z.array(zScriptItem)).min(1),
	z.array(zScriptItem).min(1),
]);

/** Splits a flat script after each run of tool calls, as a model's steps end. */
const toSteps = (script: z.infer<typeof zScript>): zScriptItem[][] => {
	if (script.every((item) => Array.isArray(item))) return script;
	const steps: zScriptItem[][] = [[]];
	for (const item of script as zScriptItem[]) {
		const step = steps.at(-1) ?? [];
		const last = step.at(-1);
		const isTool = (value?: zScriptItem) =>
			typeof value === "object" && "tool" in value;
		if (isTool(last) && !isTool(item)) steps.push([item]);
		else step.push(item);
	}
	return steps;
};

/** `\[` and friends, as the app's editor writes Markdown punctuation. */
const unescapeMarkdown = (text: string) =>
	text.replace(/\\([!-/:-@[-`{-~])/g, "$1");

/** A script in a message's text, whether bare or fenced. */
const parseScript = (
	text: string,
): { steps: zScriptItem[][] } | { error: string } | null => {
	const value = text
		.trim()
		.replace(/^```\w*\n([\s\S]*)\n```$/, "$1")
		.trim();
	if (!/^\\?\[/.test(value)) return null;

	let json: unknown;
	for (const candidate of [value, unescapeMarkdown(value)]) {
		try {
			json = JSON.parse(candidate);
			break;
		} catch {}
	}
	if (!Array.isArray(json)) return null;

	const result = zScript.safeParse(json);
	return result.success
		? { steps: toSteps(result.data) }
		: { error: z.prettifyError(result.error) };
};

const textOf = (message: LanguageModelV4Prompt[number]) =>
	typeof message.content === "string"
		? [message.content]
		: message.content.flatMap((part) =>
				part.type === "text" ? [part.text] : [],
			);

/**
 * The script the user's latest message holds, and which of its steps this
 * call is: one per reply the model has already made since. Interjections and
 * background reports also come in as the user's, but only a message the user
 * sent opens with `<message>`.
 */
const getScript = (prompt: LanguageModelV4Prompt) => {
	const sent = (message: LanguageModelV4Prompt[number]) =>
		message.role === "user" &&
		textOf(message).some((text) => text.startsWith("<message"));
	const framed = prompt.some(sent);

	for (let i = prompt.length - 1; i >= 0; i--) {
		const message = prompt[i];
		if (message.role !== "user" || (framed && !sent(message))) continue;

		for (const text of textOf(message)) {
			const script = parseScript(text);
			if (!script) continue;
			const step = prompt
				.slice(i + 1)
				.filter((message) => message.role === "assistant").length;
			return { ...script, step };
		}
		if (framed) return null;
	}
	return null;
};

const randomId = (prefix: string) =>
	`${prefix}${Math.random().toString(36).slice(2, 8)}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(
	controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
	items: zScriptItem[],
) {
	for (const entry of items) {
		const item = typeof entry === "string" ? { text: entry } : entry;

		if ("wait" in item) {
			await sleep(item.wait);
		} else if ("error" in item) {
			controller.error(new Error(item.error));
			return false;
		} else if ("tool" in item) {
			const id = randomId("t");
			const input = JSON.stringify(item.input ?? {});
			const delay = item.delay ?? DELAY;
			controller.enqueue({ type: "tool-input-start", id, toolName: item.tool });
			for (let i = 0; i < input.length; i += 4) {
				controller.enqueue({
					type: "tool-input-delta",
					id,
					delta: input.slice(i, i + 4),
				});
				if (delay) await sleep(delay);
			}
			controller.enqueue({ type: "tool-input-end", id });
			controller.enqueue({
				type: "tool-call",
				toolCallId: id,
				toolName: item.tool,
				input,
			});
		} else {
			const reasoning = "thought" in item;
			const value = reasoning ? item.thought : item.text;
			const id = randomId(reasoning ? "r" : "t");
			const delay = item.delay ?? DELAY;
			const tokens = value.repeat(item.repeat ?? 1).match(/\s+|\S+/g) ?? [];
			controller.enqueue({
				type: reasoning ? "reasoning-start" : "text-start",
				id,
			});
			for (const token of tokens) {
				controller.enqueue({
					type: reasoning ? "reasoning-delta" : "text-delta",
					id,
					delta: token,
				});
				if (delay) await sleep(delay);
			}
			controller.enqueue({
				type: reasoning ? "reasoning-end" : "text-end",
				id,
			});
		}
	}
	return true;
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
							controller.enqueue({ type: "stream-start", warnings: [] });

							const script = getScript(options.prompt);
							const items: zScriptItem[] = !script
								? [{ text: WELCOME, delay: 0 }, { wait: 1000 }]
								: "error" in script
									? [`The script is invalid:\n\n${script.error}`]
									: (script.steps[script.step] ?? []);
							if (!(await run(controller, items))) return;

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
									outputTokens: { total: 0, text: 0, reasoning: 0 },
								},
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
