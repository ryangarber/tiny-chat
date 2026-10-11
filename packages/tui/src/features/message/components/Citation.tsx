import { type DOMElement, useWindowSize } from "ink";
import {
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { ComponentUtils } from "#client/core/utils/ComponentUtils.ts";
import {
	type Source,
	SourceUtils,
} from "#core/features/data/utils/SourceUtils.ts";
import Anchor from "#tui/core/components/Anchor.tsx";
import Box from "#tui/core/components/Box.tsx";
import Span from "#tui/core/components/Span.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouse } from "#tui/core/hooks/useMouse.ts";
import { useMouseLayer } from "#tui/core/hooks/useMouseLayer.ts";
import { MouseUtils } from "#tui/core/utils/MouseUtils.ts";
import { useCitationStore } from "#tui/features/message/stores/useCitationStore.ts";

const CARD_WIDTH = 60;
/** The app clamps a citation's title to two lines. */
const TITLE_LINES = 2;

const clip = (text: string, length: number) =>
	text.length > length ? `${text.slice(0, length - 1)}…` : text;

/**
 * A citation's emoji, inline in the text it cites. Clicking it opens a
 * {@link CitationCard} with the source.
 */
export function Citation({
	sourceKey,
	sources,
	cited,
}: {
	sourceKey: string;
	sources?: Source[];
	/** What the citation is attached to, which a web source's snippet is picked by. */
	cited?: ReactNode;
}) {
	const id = useId();
	const ref = useRef<DOMElement>(null);
	const isOpen = useCitationStore((state) => state.open?.citation.id === id);
	const register = useCitationStore((state) => state.register);

	// Read only once the card opens, so a render costs nothing past the emoji.
	const latest = useRef({ sourceKey, sources, cited });
	useLayoutEffect(() => {
		latest.current = { sourceKey, sources, cited };
	});

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		return register({
			id,
			node,
			getSource: () => {
				const { sourceKey, sources, cited } = latest.current;
				return SourceUtils.getDisplay({
					sources,
					key: sourceKey,
					text: ComponentUtils.text({ children: cited }),
				});
			},
		});
	}, [id, register]);

	return (
		<>
			{" "}
			<Span ref={ref}>
				<Text backgroundColor={isOpen ? "interior" : undefined}>
					{SourceUtils.getEmoji({ sources, key: sourceKey })}
				</Text>
			</Span>
		</>
	);
}

/**
 * The card for whichever citation was clicked last. Mounted once, over
 * everything else, and only listening for clicks while there are citations.
 */
export function CitationCard() {
	const { rows, columns } = useWindowSize();
	const active = useCitationStore((state) => state.active);
	const open = useCitationStore((state) => state.open);
	const setOpen = useCitationStore((state) => state.setOpen);
	const cardRef = useRef<DOMElement>(null);

	useMouse({
		isActive: active,
		handler: (event) => {
			const { open, citations } = useCitationStore.getState();

			// Scrolling moves the citation out from under its card.
			if (event.type === "wheel") {
				if (open) setOpen(null);
				return;
			}
			if (event.type !== "down" || event.button !== "left") return;

			if (
				open &&
				cardRef.current &&
				MouseUtils.contains(MouseUtils.bounds(cardRef.current, rows), event)
			) {
				return;
			}

			for (const citation of citations) {
				const bounds = MouseUtils.textBounds(citation.node, rows);
				if (
					bounds &&
					MouseUtils.contains(bounds, event) &&
					!MouseUtils.isCovered(citation.node, event, rows)
				) {
					setOpen(open?.citation === citation ? null : { citation, bounds });
					return;
				}
			}

			if (open) setOpen(null);
		},
	});

	// The card is placed by where the citation was, which a resize moves.
	// biome-ignore lint/correctness/useExhaustiveDependencies: closes on resize only.
	useEffect(() => {
		useCitationStore.getState().setOpen(null);
	}, [rows, columns]);

	const source = useMemo(() => open?.citation.getSource(), [open]);
	useMouseLayer(cardRef, !!source);
	if (!open || !source) return null;

	const { bounds } = open;
	const width = Math.max(1, Math.min(CARD_WIDTH, columns - 2));
	const inner = width - 2;
	// Below the citation in the top half of the screen, above it in the bottom.
	const below = bounds.y < rows / 2;

	return (
		<Box
			ref={cardRef}
			position="absolute"
			top={below ? bounds.y + 1 : undefined}
			bottom={below ? undefined : rows - bounds.y}
			left={Math.max(0, Math.min(bounds.x, columns - width))}
			width={width}
			flexDirection="column"
			backgroundColor="interior"
			borderStyle="round"
			border={true}
			paddingX={1}
		>
			{source.type === "web" && (
				<>
					<Text bold wrap="truncate-end">
						{source.value.title || source.value.url}
					</Text>
					<Anchor href={source.value.url} color="textSubtle">
						{clip(source.value.url, inner)}
					</Anchor>
				</>
			)}
			{source.type !== "web" && (
				<>
					<Text bold>{clip(source.title, inner * TITLE_LINES)}</Text>
					<Text
						color="textSubtle"
						wrap={source.type === "file" ? "truncate-start" : "wrap"}
					>
						{source.description}
					</Text>
				</>
			)}
		</Box>
	);
}
