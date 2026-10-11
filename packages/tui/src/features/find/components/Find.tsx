import { type DOMElement, type Key, useInput } from "ink";
import { type RefObject, useEffect, useRef, useState } from "react";
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
import { useFindInElement } from "#tui/features/find/hooks/useFindInElement.ts";
import Textarea from "#tui/features/textarea/components/Textarea.tsx";
import type {
	TextareaCursor,
	TextareaSelection,
} from "#tui/features/textarea/types/textarea.ts";
import { TextareaUtils } from "#tui/features/textarea/utils/TextareaUtils.ts";

/** Columns the query is typed into. */
const INPUT_WIDTH = 20;

/**
 * A find bar for the text drawn under `targetRef`, opened with Ctrl+F and
 * drawn in the target's top right corner — so it has to be rendered as the
 * target's last child, over everything else in it.
 *
 * While open it takes the keys like any other focusable, Tab moving away from
 * it and Ctrl+F coming back; Enter or ↓ steps to the next match, Shift+Enter
 * or ↑ to the previous one, and Escape closes it.
 */
export default function Find({
	id = "page",
	targetRef,
	disabled = false,
}: {
	/** Tells bars apart in the focus, for a target holding another target. */
	id?: string;
	targetRef: RefObject<DOMElement | null>;
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
	const { isOpen } = find;

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

	useInput(
		(input, key) => {
			if (!key.ctrl || input !== "f") return;
			if (!isOpen) {
				returnRef.current = selectFocus(useAppStore.getState());
				find.open();
			}
			// The query is selected, ready to be typed over.
			const { query } = find;
			setCursor(TextareaUtils.cursor(query, query.length));
			setSelection(query ? [0, query.length] : null);
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
				<Text color={focused ? "primary" : "textSubtle"}>find</Text>
				<Box width={INPUT_WIDTH} flexShrink={0}>
					<Textarea
						value={find.query}
						onChange={find.setQuery}
						focus={focused}
						cursor={cursor}
						onCursorChange={setCursor}
						selection={selection}
						onSelectionChange={setSelection}
						placeholder="text on screen"
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
