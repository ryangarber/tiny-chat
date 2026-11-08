import type {
	LanguageModelV4,
	LanguageModelV4Prompt,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { TestProvider } from "#core/features/provider/providers/model/TestProvider.ts";

const model = TestProvider.getLanguageModel({
	user: { id: "test", name: "test", settings: {}, isEphemeral: true },
	model: "test-generate",
	env: {},
} as never) as LanguageModelV4;

/** A message as the app frames the user's. */
const sent = (text: string): LanguageModelV4Prompt[number] => ({
	role: "user",
	content: [
		{ type: "text", text: '<message role="user" to="test-generate">' },
		{ type: "text", text },
		{ type: "text", text: "</message>" },
	],
});

const step = (): LanguageModelV4Prompt =>
	[
		{
			role: "assistant",
			content: [
				{ type: "tool-call", toolCallId: "a", toolName: "x", input: {} },
			],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "a",
					toolName: "x",
					output: { type: "text", value: "ok" },
				},
			],
		},
	] as LanguageModelV4Prompt;

/** What the model streams back, summed up by kind. */
const generate = async (prompt: LanguageModelV4Prompt) => {
	const { stream } = await model.doStream({ prompt });
	const out: string[] = [];
	const reader = stream.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const part = value as LanguageModelV4StreamPart;
			if (part.type === "text-delta") out.push(`text:${part.delta}`);
			if (part.type === "reasoning-delta") out.push(`thought:${part.delta}`);
			if (part.type === "tool-call")
				out.push(`tool:${part.toolName} ${part.input}`);
		}
	} catch (error) {
		out.push(`error:${(error as Error).message}`);
	}
	const merged: string[] = [];
	for (const item of out) {
		const [kind] = item.split(":");
		const last = merged.at(-1);
		if (last?.startsWith(`${kind}:`) && kind !== "tool")
			merged[merged.length - 1] = last + item.slice(kind.length + 1);
		else merged.push(item);
	}
	return merged;
};

describe("TestProvider", () => {
	it("greets without a script", async () => {
		expect(await generate([sent("hello")])).toEqual([
			expect.stringMatching(/^text:Welcome to Tiny Chat/),
		]);
	}, 5000);

	it("plays a script step by step, a step ending after its tool calls", async () => {
		const script = JSON.stringify([
			{ thought: "Hmm", delay: 0 },
			{ tool: "read_files", input: { reads: [] }, delay: 0 },
			{ tool: "glob_files", delay: 0 },
			{ text: "ab ", repeat: 2, delay: 0 },
		]);
		expect(await generate([sent(script)])).toEqual([
			"thought:Hmm",
			'tool:read_files {"reads":[]}',
			"tool:glob_files {}",
		]);
		expect(await generate([sent(script), ...step()])).toEqual(["text:ab ab "]);
		expect(await generate([sent(script), ...step(), ...step()])).toEqual([]);
	});

	it("reads explicit steps, fenced or escaped scripts, and errors", async () => {
		const steps = JSON.stringify([
			[{ text: "one", delay: 0 }],
			[{ text: "two", delay: 0 }],
		]);
		// An interjection is the user's too, but not a message they sent.
		const interjection: LanguageModelV4Prompt[number] = {
			role: "user",
			content: [{ type: "text", text: "go on" }],
		};
		expect(await generate([sent(steps), ...step(), interjection])).toEqual([
			"text:two",
		]);

		expect(
			await generate([sent(`\`\`\`json\n[{"text":"x","delay":0}]\n\`\`\``)]),
		).toEqual(["text:x"]);
		expect(await generate([sent('\\[{"text":"x\\_y","delay":0}\\]')])).toEqual([
			"text:x_y",
		]);
		expect(await generate([sent('[{"error":"boom"}]')])).toEqual([
			"error:boom",
		]);
		expect((await generate([sent('[{"nope":1}]')]))[0]).toMatch(
			/^text:The script is invalid/,
		);
	});

	it("greets when the latest message has no script", async () => {
		const script = JSON.stringify([{ text: "scripted", delay: 0 }]);
		const reply: LanguageModelV4Prompt[number] = {
			role: "assistant",
			content: [{ type: "text", text: "scripted" }],
		};
		expect(await generate([sent(script), reply, sent("thanks")])).toEqual([
			expect.stringMatching(/^text:Welcome/),
		]);
	}, 5000);
});
