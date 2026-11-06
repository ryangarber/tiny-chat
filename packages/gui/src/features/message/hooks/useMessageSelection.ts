import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks text selection within a specific message container identified by
 * `data-message-id`. Designed for performance:
 *
 * - `selectionchange` fires too frequently to call setState directly, so we
 *   schedule a single rAF pass per event burst and bail out early if nothing
 *   meaningful changed.
 * - The selected text is stored in a ref (no re-render) so iOS Safari can read
 *   it after a `pointerdown` / `touchstart` on the quote button clears the DOM
 *   selection before `click` fires.
 * - State only changes when the "active" flag flips (showing/hiding the button)
 *   or the bounding rect shifts enough to matter visually.
 *
 * Returns:
 *   rect            – bounding rect of the first range (null when nothing selected).
 *   textRef         – ref always containing the last non-empty selected string.
 *   captureSelection – call on onMouseDown/onTouchStart of the quote button so
 *                      the text is snapshotted before the selection is cleared.
 *   getSelectedText  – call inside onClick to get the final text, falling back
 *                      to textRef if the DOM selection was already cleared.
 */

interface SelectionRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface UseMessageSelectionReturn {
	rect: SelectionRect | null;
	textRef: React.MutableRefObject<string>;
	captureSelection: (e: React.MouseEvent | React.TouchEvent) => void;
	getSelectedText: () => string;
}

const RECT_THRESHOLD = 2; // px – ignore sub-pixel jitter

function rectsEqual(a: SelectionRect | null, b: SelectionRect): boolean {
	if (a === null) return false;
	return (
		Math.abs(a.top - b.top) < RECT_THRESHOLD &&
		Math.abs(a.left - b.left) < RECT_THRESHOLD &&
		Math.abs(a.width - b.width) < RECT_THRESHOLD &&
		Math.abs(a.height - b.height) < RECT_THRESHOLD
	);
}

export function useMessageSelection(
	messageId: string,
): UseMessageSelectionReturn {
	return useTextSelection(`[data-message-id="${messageId}"]`);
}

/**
 * The same, within whatever element matches `selector` — a message, or a
 * block of content offering to quote what is selected in it.
 */
export function useTextSelection(
	selector: string | null,
): UseMessageSelectionReturn {
	const [rect, setRect] = useState<SelectionRect | null>(null);

	// Stores the last non-empty selection string so the quote button can read it
	// even after iOS Safari clears the selection on pointerdown.
	const textRef = useRef<string>("");

	// rAF handle – we cancel the previous one if selectionchange fires again
	// before the frame executes (avoids queuing multiple updates per burst).
	const rafRef = useRef<number>(0);

	useEffect(() => {
		if (!selector) return;

		const isInMessage = (node: Node | null): boolean => {
			if (!node) return false;
			const el =
				node.nodeType === Node.TEXT_NODE
					? node.parentElement
					: (node as Element);
			return !!el?.closest(selector);
		};

		const handleSelectionChange = () => {
			// Cancel any pending frame so we only do one update per burst.
			cancelAnimationFrame(rafRef.current);

			rafRef.current = requestAnimationFrame(() => {
				const sel = window.getSelection();

				if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
					// Only call setState if we were previously showing the button.
					setRect((prev) => (prev !== null ? null : prev));
					return;
				}

				if (isInMessage(sel.anchorNode) && isInMessage(sel.focusNode)) {
					const domRect = sel.getRangeAt(0).getBoundingClientRect();
					// Capture text into the ref on every valid selection update.
					const text = sel.toString();
					if (text) textRef.current = text;

					const next: SelectionRect = {
						top: domRect.top,
						left: domRect.left,
						width: domRect.width,
						height: domRect.height,
					};

					setRect((prev) =>
						// Skip re-render if rect hasn't moved meaningfully.
						rectsEqual(prev, next) ? prev : next,
					);
				} else {
					setRect((prev) => (prev !== null ? null : prev));
				}
			});
		};

		document.addEventListener("selectionchange", handleSelectionChange, {
			passive: true,
		});

		return () => {
			document.removeEventListener("selectionchange", handleSelectionChange);
			cancelAnimationFrame(rafRef.current);
		};
	}, [selector]);

	/**
	 * Call on `onMouseDown` / `onTouchStart` of the quote button.
	 * Prevents the browser default that would clear the selection, and
	 * snapshots the current text into `textRef` as a safety net.
	 */
	const captureSelection = useCallback(
		(e: React.MouseEvent | React.TouchEvent) => {
			e.preventDefault();
			const text = window.getSelection()?.toString();
			if (text) textRef.current = text;
		},
		[],
	);

	/**
	 * Call inside the quote button `onClick` handler to get the text.
	 * Falls back to `textRef` if the DOM selection was already cleared.
	 */
	const getSelectedText = useCallback((): string => {
		return (window.getSelection()?.toString() ?? textRef.current).trim();
	}, []);

	return { rect, textRef, captureSelection, getSelectedText };
}
