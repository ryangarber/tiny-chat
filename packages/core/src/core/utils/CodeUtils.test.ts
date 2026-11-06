import { bundledLanguagesInfo } from "shiki/langs";
import { bundledThemesInfo } from "shiki/themes";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CodeRequest,
	CodeUtils,
	type CodeWorker,
	type HighlightRequest,
} from "#core/core/utils/CodeUtils.ts";

/** Answers every request on the next tick with plain tokens. */
const createEchoWorker = (): CodeWorker => {
	const instance: CodeWorker = {
		onmessage: null,
		onerror: null,
		terminate: () => {},
		postMessage: (message: HighlightRequest) => {
			if (message.type !== "highlight") return;
			setTimeout(() =>
				instance.onmessage?.({
					data: {
						type: "result",
						id: message.id,
						result: CodeUtils.unhighlight(message.code),
					},
				}),
			);
		},
	};
	return instance;
};

const request = (code: string): CodeRequest => ({
	code,
	language: "typescript",
	theme: "github-dark",
});

describe("CodeUtils", () => {
	it("has the same languages and themes as Shiki", () => {
		// out of date: run `node scripts/write-code-metadata.ts` in packages/core
		expect(CodeUtils.languages).toEqual(
			bundledLanguagesInfo.map((info) => info.id),
		);
		expect(CodeUtils.languageAliases).toEqual(
			Object.fromEntries(
				bundledLanguagesInfo.flatMap((info) =>
					(info.aliases ?? []).map((alias) => [alias, info.id]),
				),
			),
		);
		expect(CodeUtils.themes).toEqual(bundledThemesInfo.map((info) => info.id));
	});

	it("resolves languages by id or alias", () => {
		expect(CodeUtils.getLanguage("TypeScript")).toBe("typescript");
		expect(CodeUtils.getLanguage(" ts ")).toBe("typescript");
		expect(CodeUtils.getLanguage("sh")).toBe("shellscript");
		expect(CodeUtils.getLanguage("nope")).toBeNull();
	});

	it("keeps unchanged lines when reconciling a grown snippet", () => {
		const previous = {
			bg: "#000",
			fg: "#fff",
			tokens: [
				[
					{ content: "const", offset: 0, color: "#f00" },
					{ content: " a", offset: 5, color: "#0f0" },
				],
				[{ content: "le", offset: 8, color: "#00f" }],
			],
		};

		const next = CodeUtils.reconcile(previous, "const a\nlet b\nx");
		expect(next.bg).toBe("#000");
		expect(next.tokens[0]).toBe(previous.tokens[0]);
		expect(next.tokens[1]).toEqual([
			expect.objectContaining({ content: "let b", offset: 8 }),
		]);
		expect(next.tokens[2]).toEqual([
			expect.objectContaining({ content: "x", offset: 14 }),
		]);

		expect(CodeUtils.reconcile(previous, "const a\nle")).toBe(previous);
		// same text, different position: offsets would be wrong, so re-plain it
		const shifted = CodeUtils.reconcile(previous, "const ab\nle");
		expect(shifted.tokens[1]).not.toBe(previous.tokens[1]);
		expect(shifted.tokens[1][0].offset).toBe(9);
	});

	it("gives offsets to unhighlighted lines", () => {
		expect(
			CodeUtils.unhighlight("ab\n\ncd").tokens.map((line) => line[0].offset),
		).toEqual([0, 3, 4]);
	});

	describe("cache", () => {
		afterEach(() => {
			CodeUtils.setWorker(undefined);
			CodeUtils.clear();
		});

		it("caches finished code but not code still streaming in", async () => {
			CodeUtils.setWorker(createEchoWorker);

			const streaming = request("const a");
			expect(
				await CodeUtils.highlight(streaming, { incomplete: true }),
			).not.toBeNull();
			expect(CodeUtils.peek(streaming)).toBeNull();

			const finished = request("const a = 1;");
			await CodeUtils.highlight(finished);
			expect(CodeUtils.peek(finished)).not.toBeNull();
		});

		it("caches a shared job if any caller has finished code", async () => {
			CodeUtils.setWorker(createEchoWorker);

			const shared = request("let b = 2;");
			await Promise.all([
				CodeUtils.highlight(shared, { incomplete: true }),
				CodeUtils.highlight(shared),
			]);
			expect(CodeUtils.peek(shared)).not.toBeNull();
		});

		it("evicts the least recently used results past the size budget", () => {
			// one line, one token and ~5,000 cost units of code each: 59 fit
			const big = (name: string) => request(name.repeat(320_000));
			const store = (r: CodeRequest) =>
				CodeUtils.store(CodeUtils.getCacheKey(r), CodeUtils.unhighlight(""));

			const [a, b, c] = [big("a"), big("b"), big("c")];
			for (const r of [a, b, c]) store(r);
			for (let i = 0; i < 57; i++) store(big(String.fromCharCode(100 + i)));
			expect(CodeUtils.peek(a)).toBeNull();

			CodeUtils.peek(b); // b is now the most recent
			store(big("Z"));
			expect(CodeUtils.peek(b)).not.toBeNull();
			expect(CodeUtils.peek(c)).toBeNull();
		});

		it("compares the full code, not just its ends", async () => {
			CodeUtils.setWorker(createEchoWorker);

			const first = request("start\nmiddle one\nend");
			await CodeUtils.highlight(first);
			expect(CodeUtils.peek(request("start\nmiddle two\nend"))).toBeNull();
		});
	});

	it("starts a new worker a while after one fails", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			let started = 0;
			CodeUtils.setWorker(() => {
				started++;
				const instance = createEchoWorker();
				if (started === 1)
					instance.postMessage = () =>
						setTimeout(() => instance.onerror?.({ message: "load failed" }));
				return instance;
			});

			expect(await CodeUtils.highlight(request("const x = 1;"))).toBeNull();
			// still cooling down
			expect(await CodeUtils.highlight(request("const y = 2;"))).toBeNull();
			expect(started).toBe(1);

			vi.setSystemTime(Date.now() + 10_000);
			expect(await CodeUtils.highlight(request("const z = 3;"))).not.toBeNull();
			expect(started).toBe(2);
		} finally {
			vi.useRealTimers();
			CodeUtils.setWorker(undefined);
			CodeUtils.clear();
		}
	});
});
