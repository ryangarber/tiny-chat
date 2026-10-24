import { type RefObject, useEffect, useEffectEvent, useMemo } from "react";
import { useFindInScope } from "#client/features/find/hooks/useFindInScope.ts";
import { FindScopeService } from "#client/features/find/services/FindScopeService.ts";
import type { FindBlock, FindMatch } from "#client/features/find/types/find.ts";

/** `::highlight()` names the matches are painted under, styled in `find.css`. */
const HIGHLIGHT = "find";
const HIGHLIGHT_CURRENT = "find-current";

/** How long content has to settle before an open bar searches it again. */
const REFRESH_DELAY = 150;

/** Elements whose text is never drawn as text. */
const SKIPPED = new Set([
	"SCRIPT",
	"STYLE",
	"NOSCRIPT",
	"TEMPLATE",
	"TEXTAREA",
	"OPTION",
]);

/**
 * Ranges painted by every bar on screen, merged under the same two names: a
 * name holds one `Highlight`, which one bar setting would take from another.
 */
const painted = new Map<symbol, { all: Range[]; current: Range[] }>();

/**
 * The two highlights, registered once and then only ever changed in place:
 * WebKit repaints the ranges a highlight loses, but not those of a highlight
 * replaced under its name, which it leaves painted on screen.
 */
let highlights: { all: Highlight; current: Highlight } | undefined;

const paint = () => {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
	if (!highlights) {
		highlights = { all: new Highlight(), current: new Highlight() };
		// Drawn over the other matches where the two meet.
		highlights.current.priority = 1;
		CSS.highlights.set(HIGHLIGHT, highlights.all);
		CSS.highlights.set(HIGHLIGHT_CURRENT, highlights.current);
	}
	highlights.all.clear();
	highlights.current.clear();
	for (const ranges of painted.values()) {
		for (const range of ranges.all) highlights.all.add(range);
		for (const range of ranges.current) highlights.current.add(range);
	}
};

const toRange = ({ start, end }: FindMatch<Text>) => {
	const range = new Range();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	return range;
};

/**
 * The text under `root`, split into blocks at every element that is not laid
 * out inline, so a match runs across links, emphasis and highlighted tokens
 * but not from one paragraph or line of a table into the next.
 */
function* textBlocks(
	root: HTMLElement,
	ignored: HTMLElement | null | undefined,
): Generator<FindBlock<Text>> {
	const blockOf = new Map<Element, Element>();
	const visible = new Map<Element, boolean>();

	const findBlock = (element: Element): Element => {
		const cached = blockOf.get(element);
		if (cached) return cached;
		const display = getComputedStyle(element).display;
		const block =
			element === root ||
			!element.parentElement ||
			!(display.startsWith("inline") || display === "contents")
				? element
				: findBlock(element.parentElement);
		blockOf.set(element, block);
		return block;
	};

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const parent = node.parentElement;
			if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
			if (SKIPPED.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
			if (ignored?.contains(parent)) return NodeFilter.FILTER_REJECT;
			let isVisible = visible.get(parent);
			if (isVisible === undefined) {
				isVisible = parent.checkVisibility({ visibilityProperty: true });
				visible.set(parent, isVisible);
			}
			return isVisible ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});

	let block: FindBlock<Text> = [];
	let current: Element | null = null;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		// biome-ignore lint/style/noNonNullAssertion: accepted nodes have a parent
		const owner = findBlock(text.parentElement!);
		if (owner !== current && block.length) {
			yield block;
			block = [];
		}
		current = owner;
		block.push({ node: text, text: text.data });
	}
	if (block.length) yield block;
}

const isScrollable = (element: Element) => {
	const { overflowX, overflowY } = getComputedStyle(element);
	return {
		x:
			/auto|scroll|overlay/.test(overflowX) &&
			element.scrollWidth > element.clientWidth,
		y:
			/auto|scroll|overlay/.test(overflowY) &&
			element.scrollHeight > element.clientHeight,
	};
};

/**
 * Centers a range in every view it is scrolled out of, up to `root`: nested
 * ones, such as a tail of output in a message, from the inside out.
 * `scrollIntoView` would do the same but also scrolls containers that only
 * hide their overflow, which the app shell relies on staying put.
 */
const reveal = (range: Range, root: Element) => {
	for (
		let element = range.startContainer.parentElement;
		element && element !== root.parentElement;
		element = element.parentElement
	) {
		const scrollable = isScrollable(element);
		if (!scrollable.x && !scrollable.y) continue;
		const view = element.getBoundingClientRect();
		const rect = range.getBoundingClientRect();
		if (scrollable.y && (rect.top < view.top || rect.bottom > view.bottom))
			element.scrollTop +=
				rect.top - view.top - (element.clientHeight - rect.height) / 2;
		if (scrollable.x && (rect.left < view.left || rect.right > view.right))
			element.scrollLeft +=
				rect.left - view.left - (element.clientWidth - rect.width) / 2;
	}
};

/**
 * Find in page over a registered scope, painted with the CSS Custom Highlight
 * API so nothing searched is wrapped or otherwise touched. What the scope does
 * not draw is searched from its data, and drawn as it is stepped onto.
 *
 * Text under `ignoreRef` — the find bar itself — is never matched.
 */
export function useFindInElement({
	ignoreRef,
}: {
	ignoreRef?: RefObject<HTMLElement | null>;
}) {
	const find = useFindInScope<Text>({
		blocksOf: (node) =>
			node instanceof HTMLElement ? textBlocks(node, ignoreRef?.current) : [],
		// Once whatever opened to show it has been laid out; and again once
		// blocks whose layout was skipped off screen (`content-visibility`) have
		// been laid out on it.
		reveal: (match) =>
			requestAnimationFrame(() => {
				const range = toRange(match);
				reveal(range, document.documentElement);
				requestAnimationFrame(() => reveal(range, document.documentElement));
			}),
	});

	const { isOpen, hits, index, scope } = find;
	const ranges = useMemo(
		() => hits.map((hit) => (hit.match ? toRange(hit.match) : null)),
		[hits],
	);

	useEffect(() => {
		const id = Symbol();
		const current = ranges[index];
		painted.set(id, {
			all: ranges.filter((range) => range !== null),
			current: current ? [current] : [],
		});
		paint();
		return () => {
			painted.delete(id);
			paint();
		};
	}, [ranges, index]);

	// Content streaming in, a message scrolled into the list, or a part opening
	// is searched again once it settles — but not the bar's own count changing.
	const isOwnMutation = useEffectEvent((records: MutationRecord[]) => {
		const ignored = ignoreRef?.current;
		return records.every((record) => ignored?.contains(record.target));
	});
	const refresh = useEffectEvent(() => find.refresh());
	useEffect(() => {
		const target = FindScopeService.get(scope)?.node();
		if (!isOpen || !(target instanceof HTMLElement)) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const observer = new MutationObserver((records) => {
			if (isOwnMutation(records)) return;
			clearTimeout(timeout);
			timeout = setTimeout(refresh, REFRESH_DELAY);
		});
		observer.observe(target, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		return () => {
			observer.disconnect();
			clearTimeout(timeout);
		};
	}, [isOpen, scope]);

	return find;
}
