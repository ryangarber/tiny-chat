import {
	type BundledLanguage,
	type BundledTheme,
	createHighlighter,
	createOnigurumaEngine,
	type GrammarState,
	getTokenStyleObject,
	type HighlighterGeneric,
	type SpecialLanguage,
	type SpecialTheme,
	type ThemedToken,
} from "shiki";
import {
	type CodeRequest,
	type CodeResult,
	CodeUtils,
} from "#core/core/utils/CodeUtils.ts";

/**
 * Tokenized prefix of an earlier request, ending on a line break, kept so a
 * snippet that grows at the end (a streaming code block, someone typing) only
 * tokenizes what is new.
 */
type Snapshot = {
	language: string;
	theme: string;
	code: string;
	lines: ThemedToken[][];
	state: GrammarState | undefined;
};

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

// Lines longer than this (minified bundles, data URIs) are left plain rather
// than stalling the queue behind one pathological line.
const MAX_LINE_LENGTH = 2_000;
const MAX_SNAPSHOTS = 32;

let highlighter: Promise<Highlighter> | undefined;

const loaded = new Map<string, Promise<boolean>>();
const snapshots: Snapshot[] = [];

/**
 * The Shiki side of `CodeUtils.highlight`. Imported only by the highlight
 * worker so grammars, themes and the regex engine stay off the main thread.
 */
export const HighlightService = {
	getHighlighter: () => {
		if (!highlighter) {
			const created = createHighlighter({
				themes: [],
				langs: [],
				// Oniguruma rather than the JS regex engine: the latter mis-tokenizes
				// on JavaScriptCore (Bun, and WebKit in the apps), and its startup cost
				// no longer matters off the main thread. The WASM is inlined, so
				// it bundles the same under Vite and Bun.
				engine: createOnigurumaEngine(import("shiki/wasm")),
			});
			// a failed chunk fetch shouldn't disable highlighting for good
			created.catch(() => {
				if (highlighter === created) highlighter = undefined;
			});
			highlighter = created;
		}
		return highlighter;
	},

	/**
	 * Loads a grammar or theme once; resolves false if Shiki doesn't have it.
	 */
	load: (kind: "language" | "theme", name: string) => {
		const key = `${kind}:${name}`;
		let promise = loaded.get(key);
		if (!promise) {
			promise = HighlightService.getHighlighter()
				.then((instance) =>
					kind === "language"
						? instance.loadLanguage(name as BundledLanguage)
						: instance.loadTheme(name as BundledTheme),
				)
				.then(
					() => true,
					(error) => {
						console.error(`[HighlightService] could not load ${key}:`, error);
						loaded.delete(key); // try again next time
						return false;
					},
				);
			loaded.set(key, promise);
		}
		return promise;
	},

	resolve: async ({ code, language, theme }: CodeRequest) => {
		const resolvedLanguage =
			CodeUtils.getLanguage(language) ?? CodeUtils.detect(code).language;
		const resolvedTheme = CodeUtils.getTheme(theme);

		const [hasLanguage, hasTheme] = await Promise.all([
			resolvedLanguage
				? HighlightService.load("language", resolvedLanguage)
				: false,
			resolvedTheme ? HighlightService.load("theme", resolvedTheme) : false,
		]);

		return {
			language:
				hasLanguage && resolvedLanguage
					? resolvedLanguage
					: ("text" satisfies SpecialLanguage),
			theme:
				hasTheme && resolvedTheme
					? resolvedTheme
					: ("none" satisfies SpecialTheme),
		};
	},

	/**
	 * Warms the highlighter so the first real request only pays for its grammar.
	 */
	prepare: async ({
		theme,
		languages = [],
	}: {
		theme: string | null;
		languages?: string[];
	}) => {
		await HighlightService.getHighlighter();
		const resolved = CodeUtils.getTheme(theme);
		if (resolved) await HighlightService.load("theme", resolved);
		for (const language of languages) {
			const resolvedLanguage = CodeUtils.getLanguage(language);
			if (resolvedLanguage) {
				await HighlightService.load("language", resolvedLanguage);
			}
		}
	},

	highlight: async (request: CodeRequest): Promise<CodeResult> => {
		const instance = await HighlightService.getHighlighter();
		const { language, theme } = await HighlightService.resolve(request);
		const { code } = request;

		const tokenize = (input: string, state: GrammarState | undefined) => {
			const result = instance.codeToTokens(input, {
				lang: language as BundledLanguage,
				theme: theme as BundledTheme,
				grammarState: state,
				tokenizeMaxLineLength: MAX_LINE_LENGTH,
			});
			return {
				lines: result.tokens.length > 0 ? result.tokens : [[]],
				state: result.grammarState,
				fg: result.fg,
				bg: result.bg,
			};
		};

		// `\r` would leave the split points below off by one, so CRLF input is
		// simply tokenized whole.
		const base = code.includes("\r")
			? undefined
			: HighlightService.findSnapshot({ language, theme, code });
		let lines = base?.lines ?? [];
		let state = base?.state;
		let offset = base?.code.length ?? 0;

		// Tokenize the new complete lines on their own so the grammar state at
		// the last line break can be kept for the next request.
		const lastBreak = code.includes("\r") ? -1 : code.lastIndexOf("\n");
		if (lastBreak >= offset) {
			const complete = tokenize(code.slice(offset, lastBreak), state);
			lines = lines.concat(HighlightService.shift(complete.lines, offset));
			state = complete.state;
			offset = lastBreak + 1;

			HighlightService.saveSnapshot({
				language,
				theme,
				code: code.slice(0, offset),
				lines,
				state,
			});
		}

		const rest = tokenize(code.slice(offset), state);
		lines = lines.concat(HighlightService.shift(rest.lines, offset));

		return {
			fg: rest.fg,
			bg: rest.bg,
			tokens: lines.map((line) => line.map(HighlightService.toToken)),
		};
	},

	/** Forgets tokenized prefixes, so the next request starts cold. */
	reset: () => {
		snapshots.length = 0;
	},

	findSnapshot: ({
		language,
		theme,
		code,
	}: {
		language: string;
		theme: string;
		code: string;
	}) => {
		let best: Snapshot | undefined;
		for (const snapshot of snapshots) {
			if (
				snapshot.language === language &&
				snapshot.theme === theme &&
				snapshot.code.length > (best?.code.length ?? 0) &&
				code.startsWith(snapshot.code)
			) {
				best = snapshot;
			}
		}
		return best;
	},

	saveSnapshot: (snapshot: Snapshot) => {
		// a request that extends a snapshot replaces it; others age out
		const index = snapshots.findIndex(
			(existing) =>
				existing.language === snapshot.language &&
				existing.theme === snapshot.theme &&
				snapshot.code.startsWith(existing.code),
		);
		if (index !== -1) snapshots.splice(index, 1);
		snapshots.push(snapshot);
		if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
	},

	shift: (lines: ThemedToken[][], by: number) => {
		if (by === 0) return lines;
		return lines.map((line) =>
			line.map((token) => ({ ...token, offset: token.offset + by })),
		);
	},

	/**
	 * Flattens a token to the plain fields the renderers read, with its styles
	 * in `htmlStyle` (as Shiki's multi-theme output has them). Keeps the
	 * message posted back to the main thread small and cloneable.
	 */
	toToken: (token: ThemedToken): CodeResult["tokens"][number][number] => {
		const htmlStyle = getTokenStyleObject(token);
		return {
			content: token.content,
			offset: token.offset,
			color: token.color,
			...(token.bgColor ? { bgColor: token.bgColor } : {}),
			...(Object.keys(htmlStyle).length > 0 ? { htmlStyle } : {}),
		};
	},
} as const;
