import {
	ActionIcon,
	Group,
	Paper,
	Portal,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import {
	ArrowsOutSimpleIcon,
	CaretDownIcon,
	CaretUpIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { FindScopeService } from "#client/features/find/services/FindScopeService.ts";
import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { useFindInElement } from "#gui/features/find/hooks/useFindInElement.ts";
import "#gui/features/find/styles/find.css";

const SCOPE = "[data-find-scope]";
/** Space between the bar and the corner of the region it is drawn in. */
const INSET = 8;

const isFindKey = (event: KeyboardEvent) =>
	(event.metaKey || event.ctrlKey) &&
	!event.altKey &&
	!event.shiftKey &&
	event.key.toLowerCase() === "f";

const isStepKey = (event: KeyboardEvent) =>
	(event.metaKey || event.ctrlKey) &&
	!event.altKey &&
	event.key.toLowerCase() === "g";

/** The scope a scope is drawn inside, and so the one it widens to. */
const parentOf = (id: string | null) => FindScopeService.get(id)?.parent;

/**
 * The find bar for the whole window, searching whichever `FindScope` was last
 * clicked or focused into: a message list, a file's preview, one block of
 * code. It is drawn in the top right corner of the region holding that scope.
 *
 * Cmd/Ctrl+F opens it on that scope. Pressed again from the bar, it widens to
 * the scope around it, and from the outermost one, `root`, it leaves the key
 * to the browser and its own find bar where there is one.
 */
export default function Find({ root }: { root: string }) {
	const runtime = useRuntime();
	const barRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	/** What had the focus before the bar took it, to hand it back on close. */
	const returnRef = useRef<HTMLElement | null>(null);
	/** The scopes around the one searched, to fall back on if it goes away. */
	const ancestorsRef = useRef<string[]>([]);

	const find = useFindInElement({ ignoreRef: barRef });
	const { isOpen, scope } = find;

	// Kept up to date as scopes come and go, for the bar's label.
	const version = useSyncExternalStore(
		FindScopeService.subscribe,
		() => FindScopeService.version(),
		() => 0,
	);

	// Pointing at or focusing into a scope makes it the one the next search is
	// in — but not the bar itself, which is drawn outside of every scope.
	useEffect(() => {
		const activate = (event: Event) => {
			const target = event.target;
			if (!(target instanceof Element) || barRef.current?.contains(target))
				return;
			const element = target.closest(SCOPE);
			useFindStore
				.getState()
				.activate(element?.getAttribute("data-find-scope") ?? null);
		};
		document.addEventListener("pointerdown", activate, true);
		document.addEventListener("focusin", activate, true);
		return () => {
			document.removeEventListener("pointerdown", activate, true);
			document.removeEventListener("focusin", activate, true);
		};
	}, []);

	const focus = () => {
		inputRef.current?.focus();
		inputRef.current?.select();
	};

	const target = (id: string) => {
		const ancestors: string[] = [];
		for (let parent = parentOf(id); parent; parent = parentOf(parent))
			ancestors.push(parent);
		ancestorsRef.current = ancestors;
		find.target(id);
	};

	const close = () => {
		find.close();
		returnRef.current?.focus();
		returnRef.current = null;
	};

	const widen = () => {
		const parent = parentOf(scope);
		if (!parent) return false;
		target(parent);
		find.restart();
		return true;
	};

	// A scope can go away under the bar, scrolled out of a virtualized list:
	// the search carries on in the nearest one around it that is still there.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run as scopes change
	useEffect(() => {
		if (!isOpen || !scope || FindScopeService.get(scope)) return;
		const fallback =
			ancestorsRef.current.find((id) => FindScopeService.get(id)) ??
			FindScopeService.resolve(root);
		if (!fallback) return close();
		target(fallback);
		find.restart();
	}, [isOpen, scope, version, root]);

	const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (event.defaultPrevented) return;
		if (isFindKey(event)) {
			const inBar = barRef.current?.contains(document.activeElement);
			if (isOpen && inBar) {
				if (widen()) event.preventDefault();
				// Already searching everything: the browser's own bar can take it.
				else if (runtime.platform === "web") close();
				else event.preventDefault();
				return;
			}
			const active = FindScopeService.resolve(
				useFindStore.getState().active,
				root,
			);
			if (!active) return;
			event.preventDefault();
			if (!isOpen) {
				const element = document.activeElement;
				returnRef.current =
					element instanceof HTMLElement && element !== document.body
						? element
						: null;
				target(active);
				find.open();
			} else if (active !== scope) {
				target(active);
				find.restart();
			}
			focus();
		} else if (isOpen && isStepKey(event)) {
			event.preventDefault();
			if (event.shiftKey) find.previous();
			else find.next();
		}
	});

	useEffect(() => {
		const listener = (event: KeyboardEvent) => onKeyDown(event);
		document.addEventListener("keydown", listener);
		return () => document.removeEventListener("keydown", listener);
	}, []);

	// Drawn over the region's top right corner, wherever that is on screen.
	const [position, setPosition] = useState<{ top: number; right: number }>();
	const regionNode = () => {
		const region = scope && FindScopeService.region(scope);
		const node = FindScopeService.get(region)?.node();
		return node instanceof HTMLElement ? node : null;
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-placed as scopes change
	useLayoutEffect(() => {
		const node = isOpen ? regionNode() : null;
		if (!node) return;
		const place = () => {
			const rect = node.getBoundingClientRect();
			setPosition({
				top: Math.max(rect.top, 0) + INSET,
				right: Math.max(window.innerWidth - rect.right, 0) + INSET,
			});
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(node);
		window.addEventListener("resize", place);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", place);
		};
	}, [isOpen, scope, version]);

	if (!isOpen) return null;

	const label = FindScopeService.get(scope)?.label;
	const parent = parentOf(scope);

	return (
		<Portal>
			<Paper
				ref={barRef}
				pos="fixed"
				top={`max(${position?.top ?? INSET}px, env(safe-area-inset-top, 0px))`}
				right={`max(${position?.right ?? INSET}px, env(safe-area-inset-right, 0px))`}
				w={340}
				maw={`calc(100vw - ${2 * INSET}px)`}
				p={4}
				shadow="md"
				withBorder
				style={{ zIndex: "var(--mantine-z-index-max)" }}
				role="search"
			>
				<Group gap={4} wrap="nowrap">
					<TextInput
						ref={inputRef}
						size="xs"
						variant="unstyled"
						px="xs"
						flex={1}
						miw={0}
						placeholder={label ? `Find in ${label}` : "Find"}
						aria-label={label ? `Find in ${label}` : "Find"}
						autoFocus
						onFocus={(event) => event.currentTarget.select()}
						value={find.query}
						onChange={(event) => find.setQuery(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								if (event.shiftKey) find.previous();
								else find.next();
							} else if (event.key === "Escape") {
								event.preventDefault();
								close();
							}
						}}
					/>
					{/* Only as wide as the count, the input taking whatever it leaves. */}
					<Text
						size="xs"
						c="dimmed"
						style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
						aria-live="polite"
					>
						{find.label}
					</Text>
					{parent && (
						<Tooltip
							label={`Find in ${FindScopeService.get(parent)?.label ?? "everything"}`}
							withinPortal
							zIndex={10000}
						>
							<ActionIcon
								variant="subtle"
								color="gray"
								aria-label="Widen search"
								onClick={() => {
									widen();
									focus();
								}}
							>
								<ArrowsOutSimpleIcon size={16} />
							</ActionIcon>
						</Tooltip>
					)}
					<ActionIcon
						variant="subtle"
						color="gray"
						aria-label="Previous match"
						disabled={!find.hits.length}
						onClick={find.previous}
					>
						<CaretUpIcon size={16} />
					</ActionIcon>
					<ActionIcon
						variant="subtle"
						color="gray"
						aria-label="Next match"
						disabled={!find.hits.length}
						onClick={find.next}
					>
						<CaretDownIcon size={16} />
					</ActionIcon>
					<ActionIcon
						variant="subtle"
						color="gray"
						aria-label="Close"
						onClick={close}
					>
						<XIcon size={16} />
					</ActionIcon>
				</Group>
			</Paper>
		</Portal>
	);
}
