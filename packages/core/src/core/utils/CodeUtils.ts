import type {
	BundledLanguage,
	BundledTheme,
	ThemedToken,
	TokensResult,
} from "shiki";
import {
	CODE_LANGUAGE_ALIASES,
	CODE_LANGUAGES,
	CODE_THEMES,
} from "#core/core/utils/CodeMetadata.ts";
import { flourite } from "#core/index.ts";

type CodeLanguage = BundledLanguage;
type CodeTheme = BundledTheme;
type CodeResult = Omit<TokensResult, "grammarState">;
type CodeRequest = {
	code: string;
	language: string | null;
	theme: string | null;
};

/** Messages to the highlight worker (`HighlightWorker.ts`). */
type HighlightRequest =
	| ({ type: "highlight"; id: number } & CodeRequest)
	| { type: "cancel"; id: number }
	| { type: "prepare"; theme: string | null; languages?: string[] };

/** Messages back from the highlight worker. */
type HighlightResponse =
	| { type: "result"; id: number; result: CodeResult }
	| { type: "error"; id: number; error: string };

/**
 * The part of a Web Worker (browser or Bun) the highlighter uses. Core isn't
 * typed against the DOM, so runtimes hand their `Worker` over as this.
 */
type CodeWorker = {
	postMessage: (message: HighlightRequest) => void;
	terminate: () => void;
	onmessage: ((event: any) => void) | null;
	onerror: ((event: any) => void) | null;
};

export type {
	CodeLanguage,
	CodeRequest,
	CodeResult,
	CodeTheme,
	CodeWorker,
	HighlightOptions,
	HighlightRequest,
	HighlightResponse,
};

type Job = {
	id: number;
	key: string;
	consumers: number;
	promise: Promise<CodeResult | null>;
};

type HighlightOptions = {
	signal?: AbortSignal;
	/**
	 * The code is still streaming in. Its result is superseded by the next
	 * chunk, so it's handed back without being cached.
	 */
	incomplete?: boolean;
};

// Finished results are kept by exact input in an LRU bounded by size (lines,
// tokens and characters) as well as by count.
const MAX_RESULTS = 5_000;
const MAX_RESULT_COST = 300_000;
const CHARACTERS_PER_COST = 64;

/**
 * How long highlighting stays off after the worker fails, before the next
 * request starts a new one. A worker can die of something passing (its module
 * failing to load while the dev server restarts), which shouldn't leave every
 * code block plain until the app is reloaded.
 */
const WORKER_RETRY_MS = 5_000;

let createWorker: (() => CodeWorker) | undefined;
let worker: CodeWorker | null | undefined;
let failedAt: number | null = null;
let nextId = 0;
let resultCost = 0;

const results = new Map<string, { cost: number; result: CodeResult }>();
const jobs = new Map<string, Job>();
const pending = new Map<
	number,
	{
		key: string;
		theme: string | null;
		cache: boolean;
		resolve: (result: CodeResult | null) => void;
	}
>();
const prepared = new Set<string>();
const themeColors = new Map<string, Pick<CodeResult, "bg" | "fg">>();
const lineTexts = new WeakMap<ThemedToken[], string>();

export const CodeUtils = {
	languages: CODE_LANGUAGES,
	languageAliases: CODE_LANGUAGE_ALIASES,
	themes: CODE_THEMES,

	getLanguage: (language: string | null) => {
		if (!language) return null;

		const lower = language.trim().toLowerCase();
		return (
			CODE_LANGUAGE_ALIASES[lower] ??
			CODE_LANGUAGES.find((name) => name.toLowerCase() === lower) ??
			null
		);
	},

	/**
	 * Guess the language of a snippet. `name` is what the detector called it;
	 * `language` is the Shiki id to highlight as, when we have one.
	 */
	detect: (code: string) => {
		const detected = flourite(code, { shiki: true });
		if (detected.language === "unknown") {
			return { name: null, language: null };
		}
		return {
			name: detected.language,
			language: CodeUtils.getLanguage(detected.language),
		};
	},

	getTheme: (theme: string | null) => {
		if (!theme) return null;

		const lower = theme.toLowerCase();
		return CODE_THEMES.find((name) => name.toLowerCase() === lower) ?? null;
	},

	getCacheKey: ({ code, language, theme }: CodeRequest) =>
		`${language ?? ""}\0${theme ?? ""}\0${code}`,

	/**
	 * Sets how the runtime starts the highlight worker. Shiki only ever runs
	 * there; without one, code stays unhighlighted.
	 */
	setWorker: (factory: (() => CodeWorker) | undefined) => {
		worker?.terminate();
		worker = undefined;
		failedAt = null;
		createWorker = factory;
		prepared.clear();
	},

	getWorker: () => {
		if (worker === null && failedAt !== null) {
			if (Date.now() - failedAt < WORKER_RETRY_MS) return null;
			worker = undefined;
		}
		if (worker !== undefined) return worker;
		if (!createWorker) return null;

		try {
			const instance = createWorker();
			instance.onmessage = ({ data }: { data: HighlightResponse }) => {
				const entry = pending.get(data.id);
				if (!entry) return; // cancelled
				pending.delete(data.id);

				if (data.type === "result") {
					if (entry.theme) {
						themeColors.set(entry.theme, {
							bg: data.result.bg,
							fg: data.result.fg,
						});
					}
					if (entry.cache) CodeUtils.store(entry.key, data.result);
					entry.resolve(data.result);
				} else {
					console.error("[CodeUtils] error highlighting code:", data.error);
					entry.resolve(null);
				}
			};
			instance.onerror = (event: {
				message?: string;
				preventDefault?: () => void;
			}) => {
				console.error("[CodeUtils] highlight worker failed:", event.message);
				event.preventDefault?.();
				CodeUtils.fail();
			};
			worker = instance;
		} catch (error) {
			console.error("[CodeUtils] could not start highlight worker:", error);
			worker = null;
			failedAt = Date.now();
		}
		return worker;
	},

	/** Drops the worker and everything waiting on it; the next request after a pause starts another. */
	fail: () => {
		worker?.terminate();
		worker = null;
		failedAt = Date.now();
		// a new worker has loaded nothing yet
		prepared.clear();
		for (const { resolve } of pending.values()) resolve(null);
		pending.clear();
		jobs.clear();
	},

	/**
	 * Starts the worker and loads a theme (and optionally grammars) ahead of the
	 * first code block, behind any real highlighting work.
	 */
	prepare: ({
		theme,
		languages,
	}: {
		theme: string | null;
		languages?: string[];
	}) => {
		const key = `${theme}:${languages?.join(",") ?? ""}`;
		if (prepared.has(key)) return;
		prepared.add(key);
		CodeUtils.getWorker()?.postMessage({
			type: "prepare",
			theme,
			languages,
		} satisfies HighlightRequest);
	},

	/**
	 * Returns an already-highlighted result for exactly this input.
	 */
	peek: (request: CodeRequest) => {
		const key = CodeUtils.getCacheKey(request);
		const cached = results.get(key);
		if (cached) {
			// refresh its place in the LRU
			results.delete(key);
			results.set(key, cached);
		}
		return cached?.result ?? null;
	},

	store: (key: string, result: CodeResult) => {
		CodeUtils.evict(key);
		const cost = CodeUtils.getCost(key, result);
		results.set(key, { cost, result });
		resultCost += cost;

		// the newest result stays even if it alone is over budget
		while (
			(resultCost > MAX_RESULT_COST || results.size > MAX_RESULTS) &&
			results.size > 1
		) {
			const oldest = results.keys().next().value;
			if (oldest === undefined) break;
			CodeUtils.evict(oldest);
		}
	},

	evict: (key: string) => {
		const entry = results.get(key);
		if (!entry) return;
		results.delete(key);
		resultCost -= entry.cost;
	},

	/**
	 * Roughly what a result holds on to: its lines, its tokens, and the code
	 * (in the key).
	 */
	getCost: (key: string, result: CodeResult) => {
		let cost =
			result.tokens.length + Math.ceil(key.length / CHARACTERS_PER_COST);
		for (const line of result.tokens) cost += line.length;
		return cost;
	},

	/** Drops every cached result. */
	clear: () => {
		results.clear();
		resultCost = 0;
	},

	/**
	 * Highlights code in the worker, detecting the language if one is not
	 * provided. Identical concurrent requests share one job; aborting every
	 * caller cancels it if the worker hasn't started it yet. Resolves null when
	 * aborted or when highlighting isn't available.
	 */
	highlight: (
		request: CodeRequest,
		{ signal, incomplete = false }: HighlightOptions = {},
	): Promise<CodeResult | null> => {
		const cached = CodeUtils.peek(request);
		if (cached) return Promise.resolve(cached);
		if (signal?.aborted) return Promise.resolve(null);

		const instance = CodeUtils.getWorker();
		if (!instance) return Promise.resolve(null);

		const key = CodeUtils.getCacheKey(request);
		let job = jobs.get(key);
		if (!job) {
			const id = ++nextId;
			const promise = new Promise<CodeResult | null>((resolve) => {
				pending.set(id, {
					key,
					theme: request.theme,
					cache: !incomplete,
					resolve,
				});
			});
			const created: Job = { id, key, consumers: 0, promise };
			void promise.then(() => {
				if (jobs.get(key) === created) jobs.delete(key);
			});
			jobs.set(key, created);
			job = created;
			instance.postMessage({
				type: "highlight",
				id,
				...request,
			} satisfies HighlightRequest);
		}

		const current = job;
		current.consumers++;
		// a finished block asking for the same code as a streaming one gets it
		// cached
		const entry = pending.get(current.id);
		if (entry && !incomplete) entry.cache = true;

		return new Promise((resolve) => {
			const onAbort = () => {
				resolve(null);
				current.consumers--;
				if (current.consumers > 0 || !pending.has(current.id)) return;

				pending.get(current.id)?.resolve(null);
				pending.delete(current.id);
				jobs.delete(current.key);
				worker?.postMessage({
					type: "cancel",
					id: current.id,
				} satisfies HighlightRequest);
			};
			signal?.addEventListener("abort", onAbort, { once: true });

			void current.promise.then((result) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(signal?.aborted ? null : result);
			});
		});
	},

	/**
	 * What to draw while a highlight is pending: the cached result if there is
	 * one, otherwise `previous` with every line that hasn't changed kept as it
	 * was and the rest plain. A streaming block keeps its colors and only its
	 * newest lines wait on the worker.
	 */
	placeholder: (
		request: CodeRequest,
		previous?: { request: CodeRequest; result: CodeResult } | null,
	): CodeResult => {
		const cached = CodeUtils.peek(request);
		if (cached) return cached;

		if (
			previous &&
			previous.request.language === request.language &&
			previous.request.theme === request.theme
		) {
			return CodeUtils.reconcile(previous.result, request.code);
		}

		return {
			...CodeUtils.unhighlight(request.code),
			...(request.theme ? themeColors.get(request.theme) : undefined),
		};
	},

	/**
	 * Reuses `previous` tokens for every line whose text and position are
	 * unchanged in `code`; other lines are plain.
	 */
	reconcile: (previous: CodeResult, code: string): CodeResult => {
		const lines = code.split("\n");
		let offset = 0;
		let reused = 0;

		const tokens = lines.map((line, index) => {
			const before = previous.tokens[index];
			const start = offset;
			offset += line.length + 1;

			if (
				before &&
				(before[0]?.offset ?? start) === start &&
				CodeUtils.getLineText(before) === line
			) {
				reused++;
				return before;
			}
			return [CodeUtils.toPlainToken(line, start)];
		});

		if (reused === lines.length && lines.length === previous.tokens.length) {
			return previous;
		}
		return { ...previous, tokens };
	},

	getLineText: (line: ThemedToken[]) => {
		let text = lineTexts.get(line);
		if (text === undefined) {
			text = line.map((token) => token.content).join("");
			lineTexts.set(line, text);
		}
		return text;
	},

	toPlainToken: (content: string, offset: number): ThemedToken => ({
		content,
		offset,
		color: "inherit",
		bgColor: "transparent",
		htmlStyle: {},
		htmlAttrs: {},
	}),

	/**
	 * Extracts a sub-range of tokens from a single-line CodeResult.
	 *
	 * `start` and `end` are character offsets (like `String.slice`). Tokens
	 * that straddle a boundary are split so only the characters inside the
	 * range are included.
	 */
	extractTokenRange: (
		result: CodeResult,
		start: number,
		end: number,
	): CodeResult => {
		const lineTokens = result.tokens[0] ?? [];
		const extracted: (typeof lineTokens)[number][] = [];

		for (const token of lineTokens) {
			const tokenStart = token.offset;
			const tokenEnd = tokenStart + token.content.length;

			if (tokenEnd <= start || tokenStart >= end) continue;

			if (tokenStart >= start && tokenEnd <= end) {
				extracted.push(token);
			} else {
				const sliceStart = Math.max(0, start - tokenStart);
				const sliceEnd = Math.min(token.content.length, end - tokenStart);
				extracted.push({
					...token,
					content: token.content.slice(sliceStart, sliceEnd),
					offset: tokenStart + sliceStart,
				});
			}
		}

		return { ...result, tokens: [extracted] };
	},

	/**
	 * Returns code with no highlighting applied.
	 */
	unhighlight: (code: string): CodeResult => {
		let offset = 0;
		return {
			bg: "transparent",
			fg: "inherit",
			tokens: code.split("\n").map((line) => {
				const token = CodeUtils.toPlainToken(line, offset);
				offset += line.length + 1;
				return [token];
			}),
		};
	},
} as const;
