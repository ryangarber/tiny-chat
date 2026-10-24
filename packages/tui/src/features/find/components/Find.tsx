import { type DOMElement, type Key, useInput } from "ink";
import {
	type RefObject,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { FindScopeService } from "#client/features/find/services/FindScopeService.ts";
import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import Box from "#tui/core/components/Box.tsx";
import Button from "#tui/core/components/Button.tsx";
import { useFocused } from "#tui/core/components/Panel.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import {
	type Focus,
	selectFocus,
	useAppStore,
} from "#tui/core/stores/useAppStore.ts";
import { useFindClicks } from "#tui/features/find/hooks/useFindClicks.ts";
import { useFindInElement } from "#tui/features/find/hooks/useFindInElement.ts";
import Textarea from "#tui/features/textarea/components/Textarea.tsx";
import type {
	TextareaCursor,
	TextareaSelection,
} from "#tui/features/textarea/types/textarea.ts";
import { TextareaUtils } from "#tui/features/textarea/utils/TextareaUtils.ts";

/** Columns the query is typed into. */
const INPUT_WIDTH = 20;

/** The scope a scope is drawn inside, and so the one it widens to. */
const parentOf = (id: string | null) => FindScopeService.get(id)?.parent;

/**
 * A find bar, opened with Ctrl+F on whichever find scope was last clicked
 * into or holds the focus — the messages, a panel, one block of code — or
 * else on `root`. It is drawn in the top right corner of `targetRef`, which
 * the highlights are placed against too, so it has to be rendered as that
 * target's last child, over everything else in it.
 *
 * While open it takes the keys like any other focusable, Tab moving away from
 * it and Ctrl+F coming back, or, pressed while it has them, widening the
 * search to the scope around the one searched. Enter or ↓ steps to the next
 * match, Shift+Enter or ↑ to the previous one, and Escape closes it.
 */
export default function Find({
	id = "page",
	targetRef,
	root,
	fixed = false,
	disabled = false,
}: {
	/** Tells bars apart in the focus, for a page with a bar of its own. */
	id?: string;
	targetRef: RefObject<DOMElement | null>;
	/** The scope searched where no other is, or that this bar only searches. */
	root: string;
	/** Only ever searches `root`, as a page's own bar does. */
	fixed?: boolean;
	/** Leaves Ctrl+F to anything else listening for it. */
	disabled?: boolean;
}) {
	const focusable = `find:${id}` as const;
	const barRef = useRef<DOMElement>(null);
	const highlightsRef = useRef<DOMElement>(null);
	/** What had the keys before the bar took them, to hand them back on close. */
	const returnRef = useRef<Focus>("editor");

	const find = useFindInElement({
		targetRef,
		skipRefs: [barRef, highlightsRef],
	});
	const { isOpen, scope } = find;

	// Kept up to date as scopes come and go, for the bar's label.
	const version = useSyncExternalStore(
		FindScopeService.subscribe,
		FindScopeService.version,
	);
	useFindClicks(!disabled && !fixed);

	const [cursor, setCursor] = useState<TextareaCursor>([0, 0]);
	const [selection, setSelection] = useState<TextareaSelection | null>(null);

	const focused = useFocused(focusable);
	const setFocus = useAppStore((state) => state.setFocus);
	const addFocusable = useAppStore((state) => state.addFocusable);
	const removeFocusable = useAppStore((state) => state.removeFocusable);

	useEffect(() => {
		if (!isOpen) return;
		addFocusable(focusable);
		return () => removeFocusable(focusable);
	}, [isOpen, focusable, addFocusable, removeFocusable]);

	/** The scopes around the one searched, to fall back on if it goes away. */
	const ancestorsRef = useRef<string[]>([]);
	const target = (scope: string) => {
		const ancestors: string[] = [];
		for (let parent = parentOf(scope); parent; parent = parentOf(parent))
			ancestors.push(parent);
		ancestorsRef.current = ancestors;
		find.target(scope);
	};

	// A scope can go away under the bar, scrolled out of a virtualized list:
	// the search carries on in the nearest one around it that is still there.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run as scopes change
	useEffect(() => {
		if (!isOpen || !scope || FindScopeService.get(scope)) return;
		const fallback =
			ancestorsRef.current.find((id) => FindScopeService.get(id)) ??
			FindScopeService.resolve(root);
		if (!fallback) return;
		target(fallback);
		find.restart();
	}, [isOpen, scope, version, root]);

	useInput(
		(input, key) => {
			if (!key.ctrl || input !== "f") return;
			const active = FindScopeService.resolve(
				fixed ? root : useFindStore.getState().active,
				root,
			);
			if (!active) return;
			if (!isOpen) {
				returnRef.current = selectFocus(useAppStore.getState());
				target(active);
				find.open();
			} else if (focused) {
				const parent = fixed ? undefined : parentOf(scope);
				if (parent) {
					target(parent);
					find.restart();
				}
			} else if (active !== scope) {
				target(active);
				find.restart();
			}
			// The query is selected, ready to be typed over.
			const { query } = find;
			setCursor(TextareaUtils.cursor(query, query.length));
			setSelection(query ? [0, query.length] : null);
			// Listed before it is focused, not once the bar's effect has run: until
			// then the focus would fall back to the editor, and the fullscreen page
			// the bar is drawn on would close under it.
			addFocusable(focusable);
			setFocus(focusable);
		},
		{ isActive: !disabled },
	);

	const close = () => {
		find.close();
		setFocus(returnRef.current);
	};

	const handleKey = (_input: string, key: Key) => {
		if (key.escape) close();
		else if (key.upArrow || (key.return && key.shift)) find.previous();
		else if (key.downArrow) find.next();
		else return false;
		return true;
	};

	// The highlights are left to the text they mark; only the bar takes the mouse.
	useMouseLayer(barRef, isOpen);

	if (!isOpen) return null;

	return (
		<>
			<Box ref={highlightsRef} position="absolute" top={0} left={0}>
				{find.highlights.map((highlight) => (
					<Box
						key={`${highlight.x}:${highlight.y}`}
						position="absolute"
						top={highlight.y}
						left={highlight.x}
					>
						<Text
							color="black"
							backgroundColor={highlight.current ? "#ff9632" : "yellow"}
							wrap="truncate-end"
						>
							{highlight.text}
						</Text>
					</Box>
				))}
			</Box>
			<Box
				ref={barRef}
				position="absolute"
				top={0}
				right={0}
				paddingX={1}
				gap={1}
				backgroundColor="exterior"
			>
				<Box maxWidth={24} flexShrink={1}>
					<Text color={focused ? "primary" : "textSubtle"} wrap="truncate-end">
						find in {FindScopeService.get(scope)?.label ?? "page"}
					</Text>
				</Box>
				<Box width={INPUT_WIDTH} flexShrink={0}>
					<Textarea
						value={find.query}
						onChange={find.setQuery}
						focus={focused}
						cursor={cursor}
						onCursorChange={setCursor}
						selection={selection}
						onSelectionChange={setSelection}
						placeholder="text"
						onEnter={find.next}
						onSubmit={find.next}
						onKey={handleKey}
					/>
				</Box>
				<Text color="textSubtle">{find.label ?? "0/0"}</Text>
				<Button label="↑" onClick={find.previous} />
				<Button label="↓" onClick={find.next} />
				<Button label="×" onClick={close} />
			</Box>
		</>
	);
}
