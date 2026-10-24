import { Box, ScrollArea, type ScrollAreaProps } from "@mantine/core";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useVirtualList } from "#gui/core/hooks/useVirtualList.ts";

/**
 * A long list in its own scrolling viewport, mounting only the items near
 * what is on screen. It fills what its parent gives it, shrinking to its
 * items when they are fewer.
 */
export default function VirtualList<T>({
	items,
	getKey,
	renderItem,
	gap = 0,
	focused,
	onFocused,
	...props
}: {
	items: T[];
	getKey: (item: T) => string;
	renderItem: (item: T) => ReactNode;
	/** Space between items, in pixels. */
	gap?: number;
	/** The key of an item to scroll to and highlight, once it is listed. */
	focused?: string | null;
	/** After scrolling to `focused`. */
	onFocused?: () => void;
} & Omit<ScrollAreaProps, "children">) {
	const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
	const keys = useMemo(() => items.map(getKey), [items, getKey]);
	const { isMounted, slotProps } = useVirtualList({
		viewport,
		keys,
		overscan: 600,
	});

	// Scrolled to through its slot, which is there whether or not it is
	// mounted; once it is, the items around it take their real heights, so it
	// is scrolled to again.
	useEffect(() => {
		if (!focused || !viewport || !keys.includes(focused)) return;
		const find = () =>
			viewport.querySelector<HTMLElement>(
				`[data-virtual-key="${CSS.escape(focused)}"]`,
			);
		find()?.scrollIntoView({ block: "center" });
		// Not cancelled when `focused` is cleared, which `onFocused` does.
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const node = find();
				node?.scrollIntoView({ block: "center" });
				node?.animate(
					[
						{ backgroundColor: "var(--mantine-color-blue-light)" },
						{ backgroundColor: "transparent" },
					],
					{ duration: 1500, easing: "ease-out" },
				);
			});
		});
		onFocused?.();
	}, [focused, viewport, keys, onFocused]);

	return (
		<ScrollArea
			flex="0 1 auto"
			mih={0}
			offsetScrollbars
			type="auto"
			// The root's height comes from flexing, which the viewport's 100% can't
			// be taken from, so the viewport flexes down to it in turn.
			styles={{
				root: { display: "flex", flexDirection: "column" },
				viewport: { flex: "0 1 auto", minHeight: 0 },
			}}
			{...props}
			viewportRef={setViewport}
		>
			{items.map((item, index) => (
				<Box
					key={keys[index]}
					{...slotProps(index)}
					pb={index < items.length - 1 ? gap : 0}
					style={{
						...slotProps(index).style,
						borderRadius: "var(--mantine-radius-md)",
					}}
				>
					{isMounted(index) && renderItem(item)}
				</Box>
			))}
		</ScrollArea>
	);
}
