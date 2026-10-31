import type {
	CompletionGroup,
	CompletionItem,
} from "#client/features/editor/types/completion.ts";

/** Letters and digits only: the characters a name is matched on. */
const compact = (value: string) =>
	value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const words = (value: string) =>
	value
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		// Bounds the search below; no name has more parts than this that matters.
		.slice(0, 10);

/** Edits tolerated for a run of this length: short runs must be exact. */
const tolerance = (length: number) => (length < 4 ? 0 : length < 7 ? 1 : 2);

/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps. */
const distance = (a: string, b: string) => {
	const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
	for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;

	for (let i = 1; i <= a.length; i += 1) {
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			rows[i][j] = Math.min(
				rows[i - 1][j] + 1,
				rows[i][j - 1] + 1,
				rows[i - 1][j - 1] + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
			}
		}
	}
	return rows[a.length][b.length];
};

/** How far `query` is from the start of `value`, forgiving a missing or extra tail character. */
const prefixDistance = (query: string, value: string) => {
	let best = Number.POSITIVE_INFINITY;
	for (
		let length = Math.max(1, query.length - 1);
		length <= Math.min(value.length, query.length + 1);
		length += 1
	) {
		best = Math.min(best, distance(query, value.slice(0, length)));
	}
	return best;
};

/**
 * Cover the query with pieces, each found inside a different word, in any
 * order, so `astra6` finds `gpt-6-astra` and `ptastra` reaches across `gpt`
 * and `astra`. Costs one per piece, one per piece starting mid-word, and one
 * per piece out of the name's order. Null when it can't be covered.
 */
const segment = ({ query, parts }: { query: string; parts: string[] }) => {
	const memo = new Map<number, number | null>();

	const search = (
		position: number,
		used: number,
		last: number,
	): number | null => {
		if (position === query.length) return 0;

		const key = (position * 1024 + used) * 16 + last + 1;
		if (memo.has(key)) return memo.get(key) ?? null;

		let best: number | null = null;
		for (let part = 0; part < parts.length; part += 1) {
			if (used & (1 << part)) continue;

			for (let end = query.length; end > position; end -= 1) {
				const index = parts[part].indexOf(query.slice(position, end));
				if (index < 0) continue;

				const rest = search(end, used | (1 << part), part);
				if (rest === null) continue;

				const cost = 2 + (index > 0 ? 1 : 0) + (part < last ? 1 : 0) + rest;
				if (best === null || cost < best) best = cost;
			}
		}

		memo.set(key, best);
		return best;
	};

	return search(0, 0, -1);
};

/** Whether the query's characters appear in order, and how spread out they are. */
const scatter = ({ query, value }: { query: string; value: string }) => {
	let first = -1;
	let position = 0;
	for (const character of query) {
		position = value.indexOf(character, position);
		if (position < 0) return null;
		if (first < 0) first = position;
		position += 1;
	}
	return position - first - query.length;
};

/**
 * Tolerate typos: every letter or digit run of the query must land near the
 * start of its own word, or the whole query near the start of the name.
 */
const typo = ({
	query,
	value,
	parts,
}: {
	query: string;
	value: string;
	parts: string[];
}) => {
	if (query.length < 4) return null;

	const whole = prefixDistance(query, value);
	let best = whole <= tolerance(query.length) ? whole : null;

	const runs = query.match(/\p{L}+|\p{N}+/gu) ?? [];
	if (runs.length >= 1 && runs.length <= parts.length) {
		const used = new Set<number>();
		let total = 0;
		for (const run of runs) {
			let choice: { part: number; cost: number } | null = null;
			parts.forEach((part, index) => {
				if (used.has(index)) return;
				const cost = part.includes(run) ? 0 : prefixDistance(run, part);
				if (cost > tolerance(run.length)) return;
				if (!choice || cost < choice.cost) choice = { part: index, cost };
			});
			if (!choice) return best;
			const { part, cost } = choice as { part: number; cost: number };
			used.add(part);
			total += cost;
		}
		if (best === null || total < best) best = total;
	}

	return best;
};

type Weight = readonly number[];

/**
 * Lower sorts first: exact, prefix, substring, then looser matches: pieces
 * spread over words in any order, characters in order, and finally typos.
 */
const weight = ({
	name,
	query,
}: {
	name: string;
	query: string;
}): Weight | null => {
	if (!query) return [0, 0, 0, 0];

	const value = compact(name);
	const parts = words(name);

	if (value === query) return [0, 0, 0, value.length];

	const index = value.indexOf(query);
	if (index === 0) return [1, 0, 0, value.length];
	if (index > 0) return [2, 0, index, value.length];

	const covered = segment({ query, parts });
	if (covered !== null) return [3, covered, 0, value.length];

	if (query.length >= 3) {
		const spread = scatter({ query, value });
		if (spread !== null) return [4, spread, 0, value.length];
	}

	const typos = typo({ query, value, parts });
	if (typos !== null) return [5, typos, 0, value.length];

	return null;
};

export const CompletionUtils = {
	/**
	 * Keep only completion items resembling `query`, ordered by how directly
	 * their displayed name matches it. Separators and word order don't matter,
	 * and small typos are forgiven. The original order breaks ties so a
	 * caller's deliberate ordering remains intact.
	 */
	filter: <T extends CompletionItem>({
		items,
		query = "",
	}: {
		items: T[];
		query?: string;
	}): T[] => {
		const normalizedQuery = compact(query);

		return items
			.map((item, order) => ({
				item,
				order,
				weight: weight({
					name: item.name ?? item.value,
					query: normalizedQuery,
				}),
			}))
			.filter(
				(entry): entry is typeof entry & { weight: Weight } =>
					entry.weight !== null,
			)
			.sort((a, b) => {
				for (let index = 0; index < a.weight.length; index += 1) {
					const difference = a.weight[index] - b.weight[index];
					if (difference) return difference;
				}
				return a.order - b.order;
			})
			.map(({ item }) => item);
	},

	/**
	 * The tabs a list can be narrowed to with ←→: every item (`null`) first,
	 * then each named group that has any. A list of fewer than two such groups
	 * has nothing to narrow, so no tabs.
	 */
	tabs: (groups: readonly CompletionGroup[]): (string | null)[] => {
		const names = [
			...new Set(
				groups.flatMap((group) =>
					group.name && group.items.length ? [group.name] : [],
				),
			),
		];
		return names.length > 1 ? [null, ...names] : [];
	},

	/**
	 * The tab `direction` steps to from `tab`, wrapping around. A tab the list
	 * no longer has steps from every item.
	 */
	stepTab: ({
		tabs,
		tab,
		direction,
	}: {
		tabs: readonly (string | null)[];
		tab: string | null;
		direction: -1 | 1;
	}): string | null => {
		if (!tabs.length) return null;
		const index = Math.max(0, tabs.indexOf(tab));
		return tabs[(index + direction + tabs.length) % tabs.length] ?? null;
	},

	/** The groups a tab shows: its own, or all of them when it is gone. */
	inTab: <T extends CompletionGroup>({
		groups,
		tab,
	}: {
		groups: T[];
		tab: string | null;
	}): T[] => {
		if (tab === null || !CompletionUtils.tabs(groups).includes(tab))
			return groups;
		return groups.filter((group) => group.name === tab);
	},
} as const;
